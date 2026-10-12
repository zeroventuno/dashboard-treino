// Pull COROS activities into the athlete's calendar.
//
// Same contract as the Strava sync: callable by the athlete ("sync now") and,
// later, by a scheduler with the same session cookie, so there is one code
// path. Everything that lands goes through importWorkouts, which already
// knows how to claim a planned session instead of duplicating it.
//
// Two shapes of call:
//   • no body        — the recent window (first connect reaches back 45 days,
//                      later ones overlap the last sync by a few days);
//   • { from, to }   — a window the athlete chose ("import a period"), at most
//                      three months, for history the recent window never reaches.
//
// COROS gives no webhook on the self-service track, so this is pull-only.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { resolveTenantId } from "@/lib/data-product";
import { clearSyncError, importWorkouts, markSync } from "@/lib/product-db";
import { APP_COOKIE } from "@/app/api/app-login/route";
import {
  CorosError, buildRecordQuery, dayRange, declaredRecordCount, describePayload, findRecords, mapRecords, pageSizeOf,
  parseImportRange,
} from "@/lib/coros";
import { openCorosLink } from "@/lib/coros-link";

/** Reach for a first connect: deep enough to give the fitness chart something
 * to work with, shallow enough not to rewrite a year of logged history. */
const FIRST_SYNC_DAYS = 45;
/** Overlap on later syncs: an activity edited or uploaded late would fall
 * through a window that started exactly at the last sync. */
const OVERLAP_DAYS = 3;

const RECORDS_TOOL = "querySportRecords";

export async function POST(req: Request) {
  const key = (await cookies()).get(APP_COOKIE)?.value;
  const tenantId = key ? await resolveTenantId(key) : null;
  if (!tenantId) return NextResponse.json({ ok: false, code: "unauthorized" }, { status: 401 });

  // An absent or unparseable body is the plain "sync now" — only a body that
  // names a window changes what is asked of COROS.
  const body = (await req.json().catch(() => null)) as { from?: unknown; to?: unknown } | null;
  const wantsRange = body != null && (body.from !== undefined || body.to !== undefined);
  const range = wantsRange ? parseImportRange(body?.from, body?.to) : null;
  if (range && !range.ok) {
    return NextResponse.json({ ok: false, code: "bad_range", reason: range.reason }, { status: 400 });
  }

  // A sync running after the athlete was placed under an agency would put
  // COROS-sourced sessions in front of a coach: openCorosLink refuses, same
  // as at connect.
  const opened = await openCorosLink(tenantId);
  if ("refusal" in opened) {
    return NextResponse.json({ ok: false, code: opened.refusal.code }, { status: opened.refusal.status });
  }
  const { link } = opened;

  try {
    const period = range?.ok
      ? { from: range.from, to: range.to }
      : dayRange(link.lastSyncAt ? OVERLAP_DAYS : FIRST_SYNC_DAYS);

    const { payload, pageSize } = await link.use(async (session) => {
      // The schema is read live: COROS's own guidance is not to assume tool
      // arguments, and regions may run different versions.
      const tools = await session.listTools();
      const tool = tools.find((t) => t.name === RECORDS_TOOL);
      if (!tool) {
        throw new CorosError(
          `${RECORDS_TOOL} is not offered (tools: ${tools.map((t) => t.name).slice(0, 12).join(", ") || "none"})`,
          "schema",
        );
      }
      const args = buildRecordQuery(tool, period);
      return { payload: await session.callTool(RECORDS_TOOL, args), pageSize: pageSizeOf(args) };
    });

    const records = findRecords(payload);
    const mapped = mapRecords(records);
    // Only meaningful when nothing was found: was that an answer, or a reply
    // this code could not read?
    const seen = records.length === 0 ? describePayload(payload) : { understood: true, note: null };

    // Records arrived but none could be read: a shape this code doesn't know.
    // Said by NAME — the athlete's values stay out of the message.
    const unreadable = mapped.skipped.no_id + mapped.skipped.no_date + mapped.skipped.no_duration;
    if (records.length > 0 && mapped.items.length === 0 && unreadable > 0) {
      throw new CorosError(
        `COROS returned ${records.length} record(s) this app could not read ` +
          `(no id: ${mapped.skipped.no_id}, no date: ${mapped.skipped.no_date}, no duration: ${mapped.skipped.no_duration}); ` +
          `fields: ${mapped.sampleKeys.join(", ")}` +
          (mapped.durationShapes.length ? `; duration format: ${mapped.durationShapes.map((s) => `"${s}"`).join(", ")}` : ""),
        "schema",
      );
    }

    const { needsZones: _needsZones, ...result } = await importWorkouts(tenantId, mapped.items);

    // A chosen window is history, not "the last sync": stamping it would move
    // the next plain sync's start to now and skip the first-connect reach-back.
    // Nor is a reply nobody understood a sync: stamping it would skip the
    // first-connect reach-back for a connection that has read nothing yet.
    if (!range && seen.understood) await markSync(tenantId, "coros", null);
    // The call worked: whatever failed before is no longer the state of this
    // connection — even when this reply doesn't count as a sync.
    else await clearSyncError(tenantId, "coros");

    return NextResponse.json({
      ok: true,
      fetched: records.length,
      skipped: mapped.skipped,
      // Which sports were there instead, when nothing was importable: codes or
      // short names, never a value about the athlete.
      otherSports: mapped.otherSports,
      // Only when there were no records: what the reply looked like — field
      // NAMES for a structured one, the opening words for prose.
      unrecognized: !seen.understood,
      note: seen.note,
      window: period,
      // A page that came back exactly full may have been cut short.
      maybeTruncated: pageSize !== null && records.length >= pageSize,
      // What the reply's own header said it held, when it said (the formatted
      // list does). More than was read means some entries were not understood.
      declared: typeof payload === "string" ? declaredRecordCount(payload) : null,
      ...result,
    });
  } catch (err) {
    // Stored, not just logged: a sync that keeps failing has to be visible on
    // the dashboard, or sessions quietly stop arriving and the athlete assumes
    // the feature works.
    // A schema error carries the live argument list — the whole point of
    // showing it — so it gets room; everything else stays short.
    const cap = err instanceof CorosError && err.kind === "schema" ? 700 : 280;
    const message = err instanceof Error ? err.message.slice(0, cap) : "unknown";
    console.error("[coros] sync failed:", message);
    await markSync(tenantId, "coros", message);
    const reconnect = err instanceof CorosError && err.kind === "unauthorized";
    return NextResponse.json(
      { ok: false, code: reconnect ? "needs_reconnect" : "sync_failed", error: message },
      { status: reconnect ? 409 : 502 },
    );
  }
}
