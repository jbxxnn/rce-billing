import "server-only";
import { and, eq, gt, sql } from "drizzle-orm";
import type { Database } from "../client";
import { appSessions, appUsers, auditEvents, authRateLimits } from "../schema";
export interface Administrator {
  id: string;
  email: string;
  role: "ADMIN";
}

export interface ActiveUser {
  id: string;
  email: string;
}
export function authenticationRepository(db: Database) {
  return {
    async consumeAttempt(key: string, limit: number, seconds: number) {
      const [row] = await db
        .insert(authRateLimits)
        .values({
          key,
          attempts: 1,
          expiresAt: sql`now() + ${seconds} * interval '1 second'`,
        })
        .onConflictDoUpdate({
          target: authRateLimits.key,
          set: {
            attempts: sql`CASE WHEN ${authRateLimits.expiresAt} <= now() THEN 1 ELSE least(${authRateLimits.attempts} + 1, ${limit + 1}) END`,
            expiresAt: sql`CASE WHEN ${authRateLimits.expiresAt} <= now() THEN now() + ${seconds} * interval '1 second' ELSE ${authRateLimits.expiresAt} END`,
          },
        })
        .returning({ attempts: authRateLimits.attempts });
      return row.attempts <= limit;
    },
    async findIdentity(email: string) {
      return (
        (
          await db
            .select({
              id: appUsers.id,
              email: appUsers.email,
              passwordHash: appUsers.passwordHash,
              status: appUsers.status,
              role: appUsers.role,
            })
            .from(appUsers)
            .where(sql`lower(${appUsers.email}) = ${email}`)
        )[0] ?? null
      );
    },
    /**
     * Google already verifies the Workspace domain before calling this method.
     * The billing workspace therefore provisions a local session identity on
     * first sign-in instead of maintaining a separate email allowlist.
     */
    async authorizeGoogleWorkspaceIdentity(email: string) {
      return db.transaction(async (tx) => {
        const [existing] = await tx
          .select({
            id: appUsers.id,
            status: appUsers.status,
            role: appUsers.role,
          })
          .from(appUsers)
          .where(sql`lower(${appUsers.email}) = ${email}`)
          .for("update");
        if (existing) {
          if (existing.status !== "ACTIVE" || existing.role !== "ADMIN")
            await tx
              .update(appUsers)
              .set({ status: "ACTIVE", role: "ADMIN" })
              .where(eq(appUsers.id, existing.id));
          return existing.id;
        }
        const [created] = await tx
          .insert(appUsers)
          .values({ email, role: "ADMIN", status: "ACTIVE" })
          .returning({ id: appUsers.id });
        await tx.insert(auditEvents).values({
          actorType: "SYSTEM",
          action: "auth.google_workspace_identity_created",
          entityType: "app_user",
          entityId: created.id,
          afterJson: { source: "verified-google-workspace" },
        });
        return created.id;
      });
    },
    async recordFailure(accountKey: string) {
      await db.insert(auditEvents).values({
        actorType: "SYSTEM",
        action: "auth.login_failed",
        entityType: "auth_account",
        entityId: accountKey,
      });
    },
    async createSession(
      userId: string,
      expectedHash: string,
      tokenHash: string,
      seconds: number,
      previousHash?: string,
    ) {
      return db.transaction(async (tx) => {
        // Serialize with password/role/disable changes; a stale verification cannot
        // create a valid session after an administrative reset.
        const [user] = await tx
          .select({ id: appUsers.id })
          .from(appUsers)
          .where(
            and(
              eq(appUsers.id, userId),
              eq(appUsers.passwordHash, expectedHash),
              eq(appUsers.status, "ACTIVE"),
              eq(appUsers.role, "ADMIN"),
            ),
          )
          .for("update");
        if (!user) return false;
        if (previousHash)
          await tx
            .delete(appSessions)
            .where(eq(appSessions.tokenHash, previousHash));
        const [session] = await tx
          .insert(appSessions)
          .values({
            appUserId: userId,
            tokenHash,
            expiresAt: sql`now() + ${seconds} * interval '1 second'`,
          })
          .returning({ id: appSessions.id });
        await tx
          .update(appUsers)
          .set({ lastLoginAt: sql`now()` })
          .where(eq(appUsers.id, userId));
        await tx.insert(auditEvents).values({
          actorType: "ADMIN",
          actorId: userId,
          action: "auth.login_succeeded",
          entityType: "session",
          entityId: session.id,
        });
        return true;
      });
    },
    async createGoogleSession(
      userId: string,
      tokenHash: string,
      seconds: number,
      previousHash?: string,
    ) {
      return db.transaction(async (tx) => {
        const [user] = await tx
          .select({ id: appUsers.id })
          .from(appUsers)
          .where(
            and(
              eq(appUsers.id, userId),
              eq(appUsers.status, "ACTIVE"),
              eq(appUsers.role, "ADMIN"),
            ),
          )
          .for("update");
        if (!user) return false;
        if (previousHash)
          await tx
            .delete(appSessions)
            .where(eq(appSessions.tokenHash, previousHash));
        const [session] = await tx
          .insert(appSessions)
          .values({
            appUserId: userId,
            tokenHash,
            expiresAt: sql`now() + ${seconds} * interval '1 second'`,
          })
          .returning({ id: appSessions.id });
        await tx
          .update(appUsers)
          .set({ lastLoginAt: sql`now()` })
          .where(eq(appUsers.id, userId));
        await tx.insert(auditEvents).values({
          actorType: "ADMIN",
          actorId: userId,
          action: "auth.google_login_succeeded",
          entityType: "session",
          entityId: session.id,
        });
        return true;
      });
    },
    async getActiveUser(tokenHash: string): Promise<ActiveUser | null> {
      const [row] = await db
        .select({ id: appUsers.id, email: appUsers.email })
        .from(appSessions)
        .innerJoin(appUsers, eq(appUsers.id, appSessions.appUserId))
        .where(
          and(
            eq(appSessions.tokenHash, tokenHash),
            gt(appSessions.expiresAt, sql`now()`),
            eq(appUsers.status, "ACTIVE"),
          ),
        );
      return row ?? null;
    },
    async getAdministrator(tokenHash: string): Promise<Administrator | null> {
      const [row] = await db
        .select({ id: appUsers.id, email: appUsers.email, role: appUsers.role })
        .from(appSessions)
        .innerJoin(appUsers, eq(appUsers.id, appSessions.appUserId))
        .where(
          and(
            eq(appSessions.tokenHash, tokenHash),
            gt(appSessions.expiresAt, sql`now()`),
            eq(appUsers.status, "ACTIVE"),
            eq(appUsers.role, "ADMIN"),
          ),
        );
      return row ? { id: row.id, email: row.email, role: "ADMIN" } : null;
    },
    async revoke(tokenHash: string) {
      await db.transaction(async (tx) => {
        const [session] = await tx
          .delete(appSessions)
          .where(eq(appSessions.tokenHash, tokenHash))
          .returning({ id: appSessions.id, userId: appSessions.appUserId });
        if (session)
          await tx.insert(auditEvents).values({
            actorType: "ADMIN",
            actorId: session.userId,
            action: "auth.logout",
            entityType: "session",
            entityId: session.id,
          });
      });
    },
  };
}
export type AuthenticationRepository = ReturnType<
  typeof authenticationRepository
>;
