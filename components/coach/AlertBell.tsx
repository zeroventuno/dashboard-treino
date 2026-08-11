"use client";

// O sino com contador, no formato que o Rafael usa no sistema de aluguel:
// número sobreposto ao ícone, "9+" quando passa de nove.
import { useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "./icons";

export function AlertBell({ label, className }: { label: string; className: string }) {
  const [n, setN] = useState<number | null>(null);
  const [urgent, setUrgent] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/coach/signals")
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        setN(typeof d?.count === "number" ? d.count : 0);
        setUrgent(Number(d?.urgent) > 0);
      })
      // Falha silenciosa de propósito: um badge que não carrega não pode
      // quebrar a navegação, e um "0" inventado seria pior que nenhum número.
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  return (
    <Link href="/coach/notifications" className={`relative ${className}`} aria-label={label}>
      <Icon name="bell" size={17} />
      {n != null && n > 0 && (
        <span
          className="absolute -right-1 -top-1 grid h-[15px] min-w-[15px] place-items-center rounded-full px-[3px] text-[9.5px] font-bold leading-none text-[#0a0b0d]"
          style={{ background: urgent ? "var(--bad)" : "var(--lime)" }}
        >
          {n > 9 ? "9+" : n}
        </span>
      )}
    </Link>
  );
}
