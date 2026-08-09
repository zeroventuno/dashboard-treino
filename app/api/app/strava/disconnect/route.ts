// Forget the athlete's Strava authorisation.
//
// Drops the tokens only. Sessions already imported stay on the dashboard: they
// are training history, and disconnecting a data source is not a request to
// erase months of work. Reconnecting later re-syncs on top of them safely,
// because `external_id` makes the import idempotent.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { resolveTenantId } from "@/lib/data-product";
import { deleteDeviceLink } from "@/lib/product-db";
import { APP_COOKIE } from "@/app/api/app-login/route";

export async function POST() {
  const key = (await cookies()).get(APP_COOKIE)?.value;
  const tenantId = key ? await resolveTenantId(key) : null;
  if (!tenantId) return NextResponse.json({ ok: false, code: "unauthorized" }, { status: 401 });

  await deleteDeviceLink(tenantId, "strava");
  return NextResponse.json({ ok: true });
}
