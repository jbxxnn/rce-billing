import type { AuthenticationRepository } from "../db/repositories/authentication";
import {
  digest,
  newSessionToken,
  SESSION_SECONDS,
  validSessionToken,
  verifyPassword,
} from "./crypto";
// A fixed valid cost-12 hash equalizes password work for unknown/disabled users.
// Its plaintext is irrelevant and it is never usable as an account credential.
const DUMMY_HASH =
  "$2b$12$33HylAqgxWOtyQfqfrexrO2Zlt8yekpyvkFVmx4cKN4rpUoH1dbMi";
export class AuthenticationService {
  constructor(private readonly repository: AuthenticationRepository) {}
  async login(
    email: string,
    password: string,
    previousToken?: string,
  ): Promise<string | null> {
    const normalized = email.trim().toLowerCase();
    if (!normalized || normalized.length > 254 || password.length > 256)
      return null;
    const accountKey = await digest(`account:${normalized}`);
    if (!(await this.repository.consumeAttempt("global-login", 100, 300)))
      return null;
    if (!(await this.repository.consumeAttempt(accountKey, 5, 900)))
      return null;
    const identity = await this.repository.findIdentity(normalized);
    const encoded =
      identity?.status === "ACTIVE" && identity.role === "ADMIN"
        ? identity.passwordHash
        : null;
    const valid = await verifyPassword(password, encoded ?? DUMMY_HASH);
    if (!valid || !encoded || !identity) {
      await this.repository.recordFailure(accountKey);
      return null;
    }
    const token = newSessionToken();
    const created = await this.repository.createSession(
      identity.id,
      encoded,
      await digest(token),
      SESSION_SECONDS,
      previousToken && validSessionToken(previousToken)
        ? await digest(previousToken)
        : undefined,
    );
    return created ? token : null;
  }
  async administrator(token?: string) {
    return token && validSessionToken(token)
      ? this.repository.getAdministrator(await digest(token))
      : null;
  }
  async googleLogin(
    email: string,
    previousToken?: string,
  ): Promise<string | null> {
    const normalized = email.trim().toLowerCase();
    if (!normalized || normalized.length > 254) return null;
    const userId =
      await this.repository.authorizeGoogleWorkspaceIdentity(normalized);
    const token = newSessionToken();
    const created = await this.repository.createGoogleSession(
      userId,
      await digest(token),
      SESSION_SECONDS,
      previousToken && validSessionToken(previousToken)
        ? await digest(previousToken)
        : undefined,
    );
    return created ? token : null;
  }
  async logout(token?: string) {
    if (token && validSessionToken(token))
      await this.repository.revoke(await digest(token));
  }
}
