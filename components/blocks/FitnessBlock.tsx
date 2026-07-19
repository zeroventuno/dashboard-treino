import type { DashboardData } from "@/lib/types";
import { DEFAULT_LOCALE, translator, type Locale } from "@/lib/i18n";
import { SectionCard } from "../SectionCard";
import { PmcChart } from "../PmcChart";

export function FitnessBlock({ data, locale = DEFAULT_LOCALE }: { data: DashboardData;
  locale?: Locale;
}) {
  const tr = translator(locale);
  return (
    <SectionCard title={tr("block.fitness")} subtitle={tr("block.fitness.sub")}>
      <PmcChart data={data.trainingLoad} />
    </SectionCard>
  );
}
