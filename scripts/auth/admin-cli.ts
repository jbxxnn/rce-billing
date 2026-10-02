import dotenv from "dotenv";
import { emitKeypressEvents } from "node:readline";
import { manageAdministrator } from "./manage-admin";

dotenv.config({ path: ".env.local" });
  
async function readPassword(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) {
    let value = "";
    for await (const chunk of process.stdin) {
      value += chunk.toString();
      if (value.length > 1024) throw new Error("Password input too long");
    }
    return value.replace(/\r?\n$/, "");
  }
  process.stderr.write(prompt);
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const cleanup = () => {
      process.stdin.off("keypress", onKey);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stderr.write("\n");
    };
    const onKey = (str: string, key: { name?: string; ctrl?: boolean }) => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        reject(new Error("Canceled"));
      } else if (key.name === "return") {
        cleanup();
        resolve(value);
      } else if (key.name === "backspace")
        value = [...value].slice(0, -1).join("");
      else if (str && !key.ctrl && !str.includes("\u001b")) {
        value += str;
        if (value.length > 1024) {
          cleanup();
          reject(new Error("Password input too long"));
        }
      }
    };
    process.stdin.on("keypress", onKey);
  });
}
try {
  const [action, email] = process.argv.slice(2);
  if (!["create", "reset", "disable"].includes(action) || !email)
    throw new Error(
      "Usage: npm run auth:admin -- create|reset|disable admin@example.com",
    );
  const url = process.env.DATABASE_MIGRATION_URL;
  if (!url) throw new Error("DATABASE_MIGRATION_URL is required");
  let password: string | undefined;
  if (action !== "disable") {
    password = await readPassword(
      "New password (15+ characters, maximum 72 UTF-8 bytes): ",
    );
    if (
      process.stdin.isTTY &&
      password !== (await readPassword("Confirm password: "))
    )
      throw new Error("Passwords do not match");
  }
  await manageAdministrator(
    url,
    action as "create" | "reset" | "disable",
    email,
    password,
  );
  console.log("Administrator account updated successfully.");
} catch (error) {
  console.error("Administrator operation failed:");
  console.error(error);
  process.exitCode = 1;
}
