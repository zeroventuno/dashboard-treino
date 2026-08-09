"use client";

// The page furniture: the top bar and the right-hand section rail.
//
// Both track scroll position, which is the only reason they're client
// components — everything else on this landing renders on the server.
import { useEffect, useState } from "react";
import Link from "next/link";

export const SECTIONS = [
  { id: "quem", label: "O painel" },
  { id: "oque", label: "O que faz" },
  { id: "conexoes", label: "Conexões" },
  { id: "inteligencia", label: "Inteligência" },
  { id: "painel", label: "Ao vivo" },
  { id: "precos", label: "Preços" },
] as const;

/** True once the page has moved past the hero's first screenful. */
function useScrolled(threshold = 40) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > threshold);
    onScroll();
    // Passive: this listener must never be able to delay a scroll frame.
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [threshold]);
  return scrolled;
}

/** Which section owns the viewport right now. */
function useActiveSection() {
  const [active, setActive] = useState<string>("");

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;

    const seen = new Map<string, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.intersectionRatio);
        // Most-visible wins. Picking "the first one intersecting" instead makes
        // the marker flicker backwards whenever two sections share the screen.
        let best = "";
        let ratio = 0;
        for (const [id, r] of seen) {
          if (r > ratio) {
            ratio = r;
            best = id;
          }
        }
        if (best && ratio > 0.05) setActive(best);
      },
      { threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] },
    );

    for (const s of SECTIONS) {
      const el = document.getElementById(s.id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, []);

  return active;
}

export function Nav() {
  const scrolled = useScrolled();

  return (
    <nav
      className="fixed inset-x-0 top-0 z-50 flex items-center justify-between transition-all duration-[400ms] ease-out"
      style={{
        padding: scrolled ? "14px 22px" : "26px 22px",
        background: scrolled ? "rgba(8,9,10,.72)" : "transparent",
        backdropFilter: scrolled ? "blur(14px)" : "none",
        borderBottom: `1px solid ${scrolled ? "var(--ld-line-soft)" : "transparent"}`,
      }}
    >
      <a href="#topo" className="flex items-center gap-3" aria-label="MY TRAKR">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-trakr.svg" alt="MY TRAKR" className="block h-[16px] w-auto" />
      </a>

      <div className="hidden items-center gap-[34px] lg:flex">
        {SECTIONS.filter((s) => s.id !== "painel").map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="ld-label text-[13px] tracking-[.18em] text-[var(--ld-dim)] transition-colors hover:text-[var(--ld-lime)]"
          >
            {s.label}
          </a>
        ))}
      </div>

      <Link
        href="/app"
        className="ld-label border border-[rgba(232,234,230,.22)] px-[18px] py-[10px] text-[12px] tracking-[.18em] text-[var(--ld-ink)] transition-colors duration-[350ms] hover:border-[var(--ld-lime)] hover:bg-[var(--ld-lime)] hover:text-[var(--ld-bg)] sm:px-[22px] sm:py-[11px] sm:text-[13px]"
        style={{ borderRadius: 2 }}
      >
        Começar
      </Link>
    </nav>
  );
}

export function Rail() {
  const active = useActiveSection();

  return (
    <aside className="fixed right-10 top-1/2 z-40 hidden -translate-y-1/2 grid-cols-1 justify-items-end gap-[18px] xl:grid">
      {SECTIONS.map((s) => {
        const on = active === s.id;
        return (
          <a
            key={s.id}
            href={`#${s.id}`}
            aria-current={on ? "true" : undefined}
            className="ld-label flex items-center gap-3 text-[11px] transition-colors duration-[400ms]"
            style={{ color: on ? "var(--ld-lime)" : "rgba(232,234,230,.35)" }}
          >
            <span>{s.label}</span>
            <span
              className="block h-px transition-all duration-[400ms]"
              style={{
                width: on ? 46 : 26,
                background: on ? "var(--ld-lime)" : "rgba(232,234,230,.25)",
              }}
            />
          </a>
        );
      })}
    </aside>
  );
}
