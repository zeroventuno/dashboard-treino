import type { DashboardData } from "@/lib/types";
import { DEFAULT_LOCALE, translator, type Locale } from "@/lib/i18n";
import { SectionCard } from "../SectionCard";
import { BodyMap } from "../BodyMap";

export function StrengthBlock({ data, locale = DEFAULT_LOCALE }: { data: DashboardData;
  locale?: Locale;
}) {
  const tr = translator(locale);
  return (
    <SectionCard title={tr("block.strength")} subtitle={tr("block.strength.sub")}>
      <BodyMap sessions={data.strength} />
    </SectionCard>
  );
}
