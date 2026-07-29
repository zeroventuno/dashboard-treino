import type { DashboardData } from "@/lib/types";
import { DEFAULT_LOCALE, translator, type Locale } from "@/lib/i18n";
import type { Units } from "@/lib/utils";
import { SectionCard } from "../SectionCard";
import { BodyCompositionChart } from "../BodyCompositionChart";

export function BodyBlock({ data, locale = DEFAULT_LOCALE, units = "metric" }: {
  data: DashboardData;
  locale?: Locale;
  units?: Units;
}) {
  const tr = translator(locale);
  return (
    <SectionCard title={tr("block.body")} subtitle={tr("block.body.sub")}>
      <BodyCompositionChart entries={data.bodyComposition} units={units} />
    </SectionCard>
  );
}
