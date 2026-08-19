// Land a .fit file on the athlete's calendar — from the manual upload form,
// or from the OS share sheet via the PWA's share_target (see app/manifest.ts).
// Both post here the same way: a plain multipart form with one `file` field,
// so there is exactly one code path regardless of how the file arrived.
//
// Always ends in a redirect, even on failure: this is a POST, and a share-sheet
// hand-off has nowhere sensible to render a JSON error. The result rides back
// as a query param the dashboard reads once and shows as a small notice — same
// convention DeviceConnect already uses for the Strava OAuth round trip.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { resolveTenantId } from "@/lib/data-product";
import { importWorkouts } from "@/lib/product-db";
import { parseFit, toWorkout, FitParseError } from "@/lib/fit-parse";
import { APP_COOKIE } from "@/app/api/app-login/route";

function back(req: Request, code: string, status = 303) {
  return NextResponse.redirect(new URL(`/app?import=${code}`, req.url), status);
}

export async function POST(req: Request) {
  const key = (await cookies()).get(APP_COOKIE)?.value;
  const tenantId = key ? await resolveTenantId(key) : null;
  // No session to attribute the file to. The share sheet can't carry a login
  // form, so this sends the athlete to log in rather than silently dropping
  // the file — they'll need to share again afterwards, which is disclosed on
  // the login screen's own copy, not invented here.
  if (!tenantId) return NextResponse.redirect(new URL("/app/login?from=share", req.url), 303);

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob) || file.size === 0) return back(req, "no_file");

  const buf = Buffer.from(await file.arrayBuffer());

  let activity;
  try {
    activity = parseFit(buf);
  } catch (e) {
    if (e instanceof FitParseError) return back(req, "parse_failed");
    throw e;
  }

  const item = toWorkout(activity);
  if (!item) return back(req, "unsupported_sport");

  await importWorkouts(tenantId, [item]);
  return back(req, "ok");
}
