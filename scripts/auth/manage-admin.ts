import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";
import { appUsers, auditEvents } from "../../src/db/schema";
import { hashPassword } from "../../src/auth/crypto";

/** Restricted operational command using a direct administrator DB connection. */
export async function manageAdministrator(
  url: string,
  action: "create" | "reset" | "disable",
  email: string,
  password?: string,
) {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 254)
    throw new Error("A valid email is required");
  const passwordHash =
    action !== "disable" ? await hashPassword(password ?? "") : undefined;
  const client = new Client({
    connectionString: url,
    connectionTimeoutMillis: 10_000,
  });
  try {
    await client.connect();
    await drizzle(client).transaction(async (tx) => {
      let userId: string;
      if (action === "create") {
        const [created] = await tx
          .insert(appUsers)
          .values({
            email: normalized,
            passwordHash,
            role: "ADMIN",
            status: "ACTIVE",
          })
          .returning({ id: appUsers.id });
        userId = created.id;
      } else {
        const [existing] = await tx
          .select({ id: appUsers.id })
          .from(appUsers)
          .where(sql`lower(${appUsers.email}) = ${normalized}`)
          .for("update");
        if (!existing) throw new Error("Administrator not found");
        await tx
          .update(appUsers)
          .set(action === "disable" ? { status: "DISABLED" } : { passwordHash })
          .where(eq(appUsers.id, existing.id));
        userId = existing.id;
      }
      await tx.insert(auditEvents).values({
        actorType: "MIGRATION",
        action: `auth.admin_${action}`,
        entityType: "app_user",
        entityId: userId,
        afterJson: { source: "privileged-administration-cli" },
      });
    });
  } finally {
    await client.end();
  }
}
