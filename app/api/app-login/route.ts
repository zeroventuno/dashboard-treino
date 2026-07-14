// Per-tenant auth for the product dashboard (/app), separate from the personal
// dashboard's shared password. The account API key IS the credential (like an
// API token), so we store it in an httpOnly cookie — JS can never read it, and
// revoking/rotating the key kills the session automatically.
import { NextResponse, type NextRequest } from "next/server";
import { resolveTenantId } from "@/lib/data-product";

export const APP_COOKIE = "trak_account";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function withKeyCookie(res: NextResponse, key: string): NextResponse {
  res.cookies.set(APP_COOKIE, key, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
  return res;
}

/** Magic link: /api/app-login?key=trak_… → logs in and lands on a clean /app
 *  (so the key never lingers in the address bar or browser history). */
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key") ?? "";
  const tenantId = key ? await resolveTenantId(key) : null;
  if (!tenantId) {
    return NextResponse.redirect(new URL("/app/login?erro=1", req.url));
  }
  return withKeyCookie(NextResponse.redirect(new URL("/app", req.url)), key);
}

/** Form login from /app/login. */
export async function POST(req: NextRequest) {
  const { key } = await req.json().catch(() => ({ key: "" }));
  const tenantId = typeof key === "string" && key ? await resolveTenantId(key) : null;
  if (!tenantId) {
    return NextResponse.json({ ok: false, error: "Chave não encontrada." }, { status: 401 });
  }
  return withKeyCookie(NextResponse.json({ ok: true }), key);
}

/** Logout. */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(APP_COOKIE);
  return res;
}
