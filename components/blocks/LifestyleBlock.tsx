import type { DashboardData } from "@/lib/types";
import { DEFAULT_LOCALE, translator, type Locale } from "@/lib/i18n";
import { SectionCard } from "../SectionCard";
import { LifestyleGoals } from "../LifestyleGoals";

export function LifestyleBlock({ data, locale = DEFAULT_LOCALE }: { data: DashboardData;
  locale?: Locale;
}) {
  const tr = translator(locale);
  return (
    <SectionCard title={tr("block.lifestyle")} subtitle={tr("block.lifestyle.sub")}>
      <LifestyleGoals checkins={data.checkins} />
    </SectionCard>
  );
}
