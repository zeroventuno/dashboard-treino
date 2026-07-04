import { getDashboardData } from "@/lib/data";
import { toISO } from "@/lib/utils";
import { Card } from "@/components/Card";
import { HeaderHero } from "@/components/HeaderHero";
import { PmcChart } from "@/components/PmcChart";
import { WeekBoard } from "@/components/WeekBoard";
import { SeasonTimeline } from "@/components/SeasonTimeline";
import { PerformanceIndicatorsPanel } from "@/components/PerformanceIndicators";
import { BodyMap } from "@/components/BodyMap";
import { InjuryTracker } from "@/components/InjuryTracker";
import { LifestyleGoals } from "@/components/LifestyleGoals";

export const revalidate = 60;

export default async function DashboardPage() {
  const { data, live } = await getDashboardData();
  const todayISO = toISO(new Date());
  const latestCheckin = data.checkins.length ? data.checkins[data.checkins.length - 1] : null;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-5 sm:px-6">
      {/* top bar */}
      <nav className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-[var(--surge)] text-[13px] font-black text-black">70.3</span>
          <span className="text-[13px] font-semibold tracking-tight text-[var(--text)]">Costa Navarino</span>
        </div>
        <span className="flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-muted)]">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: live ? "var(--good)" : "var(--warn)" }} />
          {live ? "Ao vivo" : "Dados de exemplo"}
        </span>
      </nav>

      <div className="flex flex-col gap-4">
        <HeaderHero latest={latestCheckin} />

        <Card title="Carga de treino · PMC">
          <PmcChart data={data.trainingLoad} />
        </Card>

        <Card title="Sua semana" action={<span className="text-[11px] text-[var(--text-faint)]">toque para detalhes</span>}>
          <WeekBoard workouts={data.workouts} todayISO={todayISO} />
        </Card>

        <Card title="Temporada">
          <SeasonTimeline phases={data.phases} milestones={data.milestones} todayISO={todayISO} />
        </Card>

        <Card title="Indicadores de performance">
          <PerformanceIndicatorsPanel ind={data.indicators} />
        </Card>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Card title="Força · uso muscular">
            <BodyMap sessions={data.strength} />
          </Card>
          <Card title="Pontos de atenção">
            <InjuryTracker injuries={data.injuries} />
          </Card>
          <Card title="Estilo de vida · média 7d">
            <LifestyleGoals checkins={data.checkins} />
          </Card>
        </div>
      </div>

      <footer className="mt-8 text-center text-[11px] text-[var(--text-faint)]">
        Atualizado automaticamente via check-ins no chat · IRONMAN 70.3 Costa Navarino
      </footer>
    </div>
  );
}
