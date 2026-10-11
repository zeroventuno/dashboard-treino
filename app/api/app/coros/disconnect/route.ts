// Forget the athlete's COROS authorisation.
//
// Drops OUR copy of the tokens only. Sessions already imported stay: they are
// training history, and unplugging a source is not a request to erase months
// of work. `external_id` keeps a later reconnect idempotent.
//
// There is no revoke call to make here: TRAKR registered as a public client
// (no secret), and COROS's revocation endpoint doesn't accept those. The
// athlete can still withdraw the grant from their COROS account.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { resolveTenantId } from "@/lib/data-product";
import { deleteDeviceLink } from "@/lib/product-db";
import { APP_COOKIE } from "@/app/api/app-login/route";

export async function POST() {
  const key = (await cookies()).get(APP_COOKIE)?.value;
  const tenantId = key ? await resolveTenantId(key) : null;
  if (!tenantId) return NextResponse.json({ ok: false, code: "unauthorized" }, { status: 401 });

  await deleteDeviceLink(tenantId, "coros");
  return NextResponse.json({ ok: true });
}
