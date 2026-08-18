import type { DashboardData } from "@/lib/types";
import type { Metric } from "@/lib/tenant-config";
import { DEFAULT_LOCALE, translator, type Locale } from "@/lib/i18n";
import { hasVitals } from "@/lib/vitals";
import { SectionCard } from "../SectionCard";
import { VitalsTrends } from "../VitalsTrends";

/**
 * History of the daily check-in signals, under the readiness hero that shows
 * only today's.
 *
 * Read-only by construction — it takes no `editable` and offers no writes, so
 * the coach drill-in at /coach/a/[tenantId] renders exactly what the athlete
 * sees.
 *
 * The card is gated here rather than in lib/blocks: `requires:` is an AND, and
 * this card is a union of five independently-gated series (see the comment on
 * VitalSeriesDef). `hasVitals` asks the honest question instead — does this
 * athlete have any declared signal with a real reading in the last six months —
 * and returns null when the answer is no. BlockBoundary renders children
 * directly, so null leaves no empty card and no stray gap in the grid.
 */
export function VitalsBlock({
  data, metrics, todayISO, locale = DEFAULT_LOCALE,
}: {
  data: DashboardData;
  metrics: Metric[];
  todayISO: string;
  locale?: Locale;
}) {
  const tr = translator(locale);
  if (!hasVitals(data.checkins, metrics, todayISO)) return null;

  return (
    <SectionCard title={tr("block.vitals")} subtitle={tr("block.vitals.sub")}>
      <VitalsTrends checkins={data.checkins} metrics={metrics} todayISO={todayISO} locale={locale} />
    </SectionCard>
  );
}
