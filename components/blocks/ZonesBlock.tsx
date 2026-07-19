import type { DashboardData } from "@/lib/types";
import { DEFAULT_LOCALE, translator, type Locale } from "@/lib/i18n";
import { SectionCard } from "../SectionCard";
import { PerformanceZones } from "../PerformanceIndicators";

export function ZonesBlock({ data, locale = DEFAULT_LOCALE }: { data: DashboardData;
  locale?: Locale;
}) {
  const tr = translator(locale);
  return (
    <SectionCard title={tr("block.zones")} subtitle={tr("block.zones.sub")}>
      <PerformanceZones ind={data.indicators} locale={locale} />
    </SectionCard>
  );
}
