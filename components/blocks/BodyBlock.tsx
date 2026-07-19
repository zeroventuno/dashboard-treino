import type { DashboardData } from "@/lib/types";
import { DEFAULT_LOCALE, translator, type Locale } from "@/lib/i18n";
import { SectionCard } from "../SectionCard";
import { BodyCompositionChart } from "../BodyCompositionChart";

export function BodyBlock({ data, locale = DEFAULT_LOCALE }: { data: DashboardData;
  locale?: Locale;
}) {
  const tr = translator(locale);
  return (
    <SectionCard title={tr("block.body")} subtitle={tr("block.body.sub")}>
      <BodyCompositionChart entries={data.bodyComposition} />
    </SectionCard>
  );
}
