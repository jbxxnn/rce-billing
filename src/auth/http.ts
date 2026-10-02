import type { AuthConfiguration } from "../config/auth";
export function validOrigin(request: Request, config: AuthConfiguration) {
  return (
    request.headers.get("origin") === config.origin &&
    request.headers.get("sec-fetch-site") !== "cross-site"
  );
}
export async function loginFields(request: Request) {
  if (
    !request.headers
      .get("content-type")
      ?.startsWith("application/x-www-form-urlencoded")
  )
    return null;
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const fields = new URLSearchParams(new TextDecoder().decode(bytes));
  if (
    fields.getAll("email").length !== 1 ||
    fields.getAll("password").length !== 1
  )
    return null;
  return { email: fields.get("email")!, password: fields.get("password")! };
}
