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
import {
  normalizeHours, normalizeSports, WEEKDAYS,
  type WeekHours, type WeekSports, type Weekday,
} from "@/lib/availability";

export async function POST(req: Request) {
  const key = (await cookies()).get(APP_COOKIE)?.value;
  const tenantId = key ? await resolveTenantId(key) : null;
  if (!tenantId || !hasProductDb()) {
    return NextResponse.json({ ok: false, code: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as
    | { hours?: unknown; long_days?: unknown; long_day?: unknown; sports?: unknown }
    | null;
  if (!body) return NextResponse.json({ ok: false, code: "bad_request" }, { status: 400 });

  const patch: {
    hours?: WeekHours; long_days?: Weekday[]; long_day?: Weekday | null; sports?: WeekSports;
  } = {};
  if (body.hours && typeof body.hours === "object") {
    patch.hours = normalizeHours(body.hours as WeekHours);
  }
  if (Array.isArray(body.long_days)) {
    patch.long_days = body.long_days.filter((d): d is Weekday => WEEKDAYS.includes(d as Weekday));
    // Clear the older single-value key so a stale one can't outlive the list
    // and reappear through longDays()'s fallback.
    patch.long_day = null;
  }
  if (body.sports && typeof body.sports === "object") {
    patch.sports = normalizeSports(body.sports as WeekSports);
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
