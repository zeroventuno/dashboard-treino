// The athlete saves their own weekly availability.
//
// Authenticated with the per-tenant cookie /app already uses, and it can only
// ever write the caller's own profile — there is no id in the payload to point
// somewhere else. Merged into the existing preferences jsonb rather than
// replacing it, so keys the coach's AI stored (equipment, notes) survive an
// athlete tapping their calendar.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { withTenant, hasProductDb } from "@/lib/product-db";
import { resolveTenantId } from "@/lib/data-product";
import { APP_COOKIE } from "@/app/api/app-login/route";
import { normalizeHours, WEEKDAYS, type WeekHours, type Weekday } from "@/lib/availability";

export async function POST(req: Request) {
  const key = (await cookies()).get(APP_COOKIE)?.value;
  const tenantId = key ? await resolveTenantId(key) : null;
  if (!tenantId || !hasProductDb()) {
    return NextResponse.json({ ok: false, code: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { hours?: unknown; long_day?: unknown } | null;
  if (!body) return NextResponse.json({ ok: false, code: "bad_request" }, { status: 400 });

  const patch: { hours?: WeekHours; long_day?: Weekday | null } = {};
  if (body.hours && typeof body.hours === "object") {
    patch.hours = normalizeHours(body.hours as WeekHours);
  }
  if (body.long_day === null || (typeof body.long_day === "string" && WEEKDAYS.includes(body.long_day as Weekday))) {
    patch.long_day = (body.long_day as Weekday) ?? null;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, code: "bad_request" }, { status: 400 });
  }

  await withTenant(tenantId, (c) =>
    c.query(
      `update profiles set preferences = preferences || $2::jsonb, updated_at = now()
        where tenant_id = $1`,
      [tenantId, JSON.stringify(patch)],
    ),
  );
  return NextResponse.json({ ok: true });
}
