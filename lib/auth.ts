export const AUTH_COOKIE = "dash_auth";

/** SHA-256 hex — works in both edge (middleware) and node runtimes. */
export async function sha256hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Token stored in the cookie once a correct password is supplied. */
export async function tokenFor(password: string): Promise<string> {
  return sha256hex(`ironman-costa-navarino::${password}`);
}
