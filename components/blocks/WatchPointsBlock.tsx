import type { DashboardData } from "@/lib/types";
import { DEFAULT_LOCALE, translator, type Locale } from "@/lib/i18n";
import { SectionCard } from "../SectionCard";
import { InjuryTracker } from "../InjuryTracker";

export function WatchPointsBlock({ data, locale = DEFAULT_LOCALE }: { data: DashboardData;
  locale?: Locale;
}) {
  const tr = translator(locale);
  return (
    <SectionCard title={tr("block.watchpoints")} subtitle={tr("block.watchpoints.sub")}>
      <InjuryTracker injuries={data.injuries} />
    </SectionCard>
  );
}
