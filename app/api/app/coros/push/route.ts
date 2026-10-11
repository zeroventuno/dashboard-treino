// Send planned sessions to the athlete's COROS schedule.
//
// One request = the sessions the athlete ticked and confirmed in the preview
// (never "everything", never on a timer): a workout put on someone's watch can
// only be removed by hand in the COROS app, so every send is an explicit act.
//
// Per session:
//   never sent                → createScheduledWorkout, remember its idInPlan;
//   sent, same day, changed   → queryScheduledWorkoutDetails (must be editable)
//                               then updateScheduledWorkout — replaced, not doubled;
//   sent, same day, unchanged → nothing;
//   sent on ANOTHER day       → refused: the old copy is still on that day and
//                               the API can't move or delete it. The athlete is
//                               told to remove it in the COROS app first.
//
// The course is built by lib/coros-workout — the same function that drew the
// preview, so what was approved is what is sent.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { resolveTenantId } from "@/lib/data-product";
import {
  devicePushesReady, getDevicePushes, getFtpWatts, getWorkoutsByIds, saveDevicePush,
} from "@/lib/product-db";
import { APP_COOKIE } from "@/app/api/app-login/route";
import { CorosError } from "@/lib/coros";
import { openCorosLink } from "@/lib/coros-link";
import { findIdInPlan, saysNotEditable, workoutToCourse } from "@/lib/coros-workout";
import { getWorkoutBlocks } from "@/lib/workout-structure";
import { toISO } from "@/lib/utils";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PER_REQUEST = 20;
const PROVIDER = "coros";

export type PushStatus =
  | "created" | "updated" | "unchanged"
  | "refused"      // not sendable (sport, date, no duration…)
  | "date_changed" // already on another day in COROS
  | "not_editable" // COROS says that copy can't be changed (done, past…)
  | "failed";

export async function POST(req: Request) {
  const key = (await cookies()).get(APP_COOKIE)?.value;
  const tenantId = key ? await resolveTenantId(key) : null;
  if (!tenantId) return NextResponse.json({ ok: false, code: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { workoutIds?: unknown } | null;
  const ids = Array.isArray(body?.workoutIds)
    ? [...new Set(body.workoutIds.filter((x): x is string => typeof x === "string" && UUID.test(x)))]
    : [];
  if (ids.length === 0) return NextResponse.json({ ok: false, code: "bad_request" }, { status: 400 });
  if (ids.length > MAX_PER_REQUEST) return NextResponse.json({ ok: false, code: "too_many" }, { status: 400 });

  // Without the table there is no memory of what was sent, and a resend would
  // duplicate. Refuse rather than risk that.
  if (!(await devicePushesReady())) return NextResponse.json({ ok: false, code: "needs_migration" }, { status: 503 });

  const opened = await openCorosLink(tenantId);
  if ("refusal" in opened) {
    return NextResponse.json({ ok: false, code: opened.refusal.code }, { status: opened.refusal.status });
  }

  const [workouts, pushes, ftp] = await Promise.all([
    getWorkoutsByIds(tenantId, ids),
    getDevicePushes(tenantId, PROVIDER),
    getFtpWatts(tenantId),
  ]);
  const sent = new Map(pushes.map((p) => [p.workout_id, p]));
  const todayISO = toISO(new Date());

  // Keyed by session, and consulted on entry: `use` replays the whole batch
  // once behind a token refresh, and a session already created in the first
  // pass must not be created a second time.
  const done = new Map<string, { workoutId: string; status: PushStatus; detail?: string }>();
  const results = { push: (x: { workoutId: string; status: PushStatus; detail?: string }) => void done.set(x.workoutId, x) };

  try {
    await opened.link.use(async (session) => {
      for (const w of workouts) {
        if (done.has(w.id)) continue;
        const m = workoutToCourse(w, getWorkoutBlocks(w, ftp), todayISO);
        if (!m.ok) {
          results.push({ workoutId: w.id, status: "refused", detail: m.reason });
          continue;
        }
        const prev = sent.get(w.id);
        try {
          if (prev && prev.remote_date !== m.date) {
            results.push({ workoutId: w.id, status: "date_changed", detail: prev.remote_date });
            continue;
          }
          if (prev && prev.payload_hash === m.hash) {
            results.push({ workoutId: w.id, status: "unchanged" });
            continue;
          }
          if (prev && prev.remote_id) {
            const details = await session.callTool("queryScheduledWorkoutDetails", { date: m.date, idInPlan: prev.remote_id });
            if (saysNotEditable(details)) {
              results.push({ workoutId: w.id, status: "not_editable" });
              continue;
            }
            const r = await session.callTool("updateScheduledWorkout", { date: m.date, idInPlan: prev.remote_id, course: m.course });
            const row = { workout_id: w.id, remote_id: findIdInPlan(r) ?? prev.remote_id, remote_date: m.date, payload_hash: m.hash };
            await saveDevicePush(tenantId, PROVIDER, row);
            sent.set(w.id, row);
            results.push({ workoutId: w.id, status: "updated" });
            continue;
          }
          if (prev && !prev.remote_id) {
            // Sent before, but COROS never gave us its id: updating is
            // impossible and creating again would double it.
            results.push({ workoutId: w.id, status: "not_editable", detail: "no_remote_id" });
            continue;
          }
          const r = await session.callTool("createScheduledWorkout", { date: m.date, course: m.course });
          // Remembered BEFORE anything else can fail: this copy now exists on
          // the athlete's schedule whether or not the rest of the batch works.
          const row = { workout_id: w.id, remote_id: findIdInPlan(r), remote_date: m.date, payload_hash: m.hash };
          await saveDevicePush(tenantId, PROVIDER, row);
          sent.set(w.id, row);
          results.push({ workoutId: w.id, status: "created" });
        } catch (err) {
          // A tool-level refusal for ONE session (bad value, date out of the
          // athlete's window) must not sink the rest. Auth failures do — `use`
          // refreshes once and retries the whole batch.
          if (err instanceof CorosError && err.kind === "unauthorized") throw err;
          results.push({ workoutId: w.id, status: "failed", detail: err instanceof Error ? err.message.slice(0, 200) : "unknown" });
        }
      }
    });
  } catch (err) {
    const reconnect = err instanceof CorosError && err.kind === "unauthorized";
    const message = err instanceof Error ? err.message.slice(0, 200) : "unknown";
    console.error("[coros] push failed:", message);
    return NextResponse.json(
      { ok: false, code: reconnect ? "needs_reconnect" : "push_failed", error: message, results: [...done.values()] },
      { status: reconnect ? 409 : 502 },
    );
  }

  // Ids that weren't the athlete's own sessions simply don't come back from the
  // RLS-scoped read; say so rather than drop them silently.
  for (const id of ids) if (!workouts.some((w) => w.id === id)) results.push({ workoutId: id, status: "refused", detail: "not_found" });

  return NextResponse.json({ ok: true, results: [...done.values()] });
}
