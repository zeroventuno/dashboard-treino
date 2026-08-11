// Multi-week plan blocks — the unit a coach actually decides in.
//
// Blocks are written by the coach's AI (save_plan_block) and applied here, the
// same division the workout bank already uses: the model drafts, the human
// approves. What the panel adds is the placement, which no chat can do — it
// needs every athlete's own availability.
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getRoster, listPlanBlocks, resolveStaffId } from "@/lib/product-db";
import { COACH_COOKIE } from "@/app/api/coach-login/route";
import { pickLocale, translator, type Locale } from "@/lib/i18n";
import { CoachNav } from "@/components/coach/CoachNav";
import { BlockApply } from "@/components/coach/BlockApply";

export const dynamic = "force-dynamic";

export default async function CoachBlocksPage() {
  const cookieKey = (await cookies()).get(COACH_COOKIE)?.value ?? null;
  if (!cookieKey) redirect("/coach/login");

  const staff = await resolveStaffId(cookieKey);
  if (!staff) redirect("/coach/login?erro=1");

  const locale: Locale = pickLocale((await headers()).get("accept-language"));
  const tr = translator(locale);

  const [blocks, roster] = await Promise.all([listPlanBlocks(staff.agencyId), getRoster(staff.id)]);

  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 pb-16 sm:px-6">
      <CoachNav active="bank" role={staff.role} name={staff.name} locale={locale} isOwner={staff.isOwner} />

      <header className="mb-5 px-1">
        <h1 className="dsp text-[24px] font-extrabold text-[var(--text)]">{tr("blocks.title")}</h1>
        <p className="mt-0.5 text-[13px] text-[var(--text-faint)]">{tr("blocks.sub")}</p>
      </header>

      <BlockApply blocks={blocks} roster={roster} locale={locale} />
    </div>
  );
}
