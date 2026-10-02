import { compare, hash } from "bcryptjs";
export const SESSION_SECONDS = 8 * 60 * 60;
export function validNewPassword(password: string) {
  return (
    [...password].length >= 15 &&
    new TextEncoder().encode(password).length <= 72
  );
}
export async function hashPassword(password: string) {
  if (!validNewPassword(password))
    throw new Error(
      "Password must contain at least 15 characters and at most 72 UTF-8 bytes",
    );
  return hash(password, 12);
}
export async function verifyPassword(password: string, encoded: string) {
  if (!password || new TextEncoder().encode(password).length > 72) return false;
  if (!/^\$2[aby]\$12\$[./A-Za-z0-9]{53}$/.test(encoded)) return false;
  return compare(password, encoded.replace(/^\$2y\$/, "$2b$"));
}
export async function digest(value: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
export function newSessionToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
export function validSessionToken(token: string) {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}
