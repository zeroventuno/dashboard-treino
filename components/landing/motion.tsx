"use client";

// Motion primitives for the landing page.
//
// One visibility hook, three components built on it. No animation library: this
// page is the first thing a prospect loads, usually on a phone on mobile data,
// and none of this needs more than a class toggle.
//
// Everything here starts hidden or at zero, which makes the failure mode brutal:
// if the trigger never fires, the page is blank and the numbers read 0 — not a
// missing animation, a wrong page. So there are three independent paths to the
// visible state, in order of preference:
//
//   1. already on screen at mount → fire immediately from geometry
//   2. IntersectionObserver → the normal path
//   3. a SHARED polling ticker → only ever armed if no observer callback has
//      been seen yet, and it checks the same geometry the observer would
//
// A blind "reveal after N milliseconds" timer was the obvious fallback and the
// wrong one: on a page this tall it fires long before the reader scrolls down,
// so every below-the-fold counter would jump to its final value with no count.
// The poll fires on geometry instead — see `reached` for why "has the reader
// got here" beats "is it on screen right now".
import { useEffect, useRef, useState, type ReactNode } from "react";

// ── shared fallback ticker ──────────────────────────────────────────────────

/** Flips true the first time ANY IntersectionObserver callback arrives. One
 * proof is enough: the API either works in this browser or it doesn't. */
let observerProven = false;

/** Checks waiting on the fallback. Each returns true once it has fired. */
const pending = new Set<() => boolean>();
let ticker: number | null = null;

function tick() {
  for (const check of [...pending]) if (check()) pending.delete(check);
  if (pending.size === 0 && ticker !== null) {
    window.clearInterval(ticker);
    ticker = null;
  }
}

/** Arms the geometry poll for one element. No-op once the observer has proven
 * itself, so the normal path costs nothing. */
function armFallback(check: () => boolean): () => void {
  if (observerProven) return () => {};
  pending.add(check);
  if (ticker === null) ticker = window.setInterval(tick, 450);
  return () => {
    pending.delete(check);
    if (pending.size === 0 && ticker !== null) {
      window.clearInterval(ticker);
      ticker = null;
    }
  };
}

/**
 * Has the reader reached this element — meaning it has entered the viewport
 * from below, whether or not it is still on screen.
 *
 * The obvious test is "currently visible" (`top < innerHeight && bottom > 0`),
 * and it silently loses anything jumped past: an anchor link, a restored scroll
 * position, a flick scroll on a phone. On the fallback path — the one that runs
 * when IntersectionObserver never fires — that meant a counter the reader had
 * already scrolled past stayed at 0 permanently.
 *
 * Reaching is monotonic, so the check can only ever turn on. Everything above
 * the fold is revealed by definition.
 */
const reached = (el: Element) => el.getBoundingClientRect().top < window.innerHeight;

/** Runs `fire` once the element is visible, by whichever of the three paths
 * gets there first. */
function useOnVisible<T extends HTMLElement>(fire: (el: T) => void, threshold = 0.1) {
  const ref = useRef<T>(null);
  const done = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const run = () => {
      if (done.current) return true;
      done.current = true;
      fire(el);
      return true;
    };

    if (reached(el)) {
      run();
      return;
    }
    if (typeof IntersectionObserver === "undefined") {
      run();
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        observerProven = true;
        if (entries.some((e) => e.isIntersecting)) {
          run();
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold },
    );
    io.observe(el);

    const disarm = armFallback(() => (reached(el) ? run() : false));

    return () => {
      io.disconnect();
      disarm();
    };
    // `fire` is recreated each render by design — the guard above makes running
    // twice impossible, so it doesn't belong in the dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threshold]);

  return ref;
}

// ── components ──────────────────────────────────────────────────────────────

export function Reveal({
  children,
  delay = 0,
  className = "",
  as = "div",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  /** `wipe` clips its children and slides them up from below the edge. */
  as?: "div" | "wipe";
}) {
  const ref = useOnVisible<HTMLDivElement>((el) => {
    el.style.transitionDelay = `${delay}ms`;
    el.classList.add("ld-in");
  });

  return (
    <div ref={ref} className={`ld-reveal ${as === "wipe" ? "ld-wipe overflow-hidden" : ""} ${className}`}>
      {as === "wipe" ? <div>{children}</div> : children}
    </div>
  );
}

/**
 * A number that counts up when it arrives. Eased so it settles instead of
 * stopping dead, and driven by requestAnimationFrame to track the display.
 *
 * If rAF never delivers a frame — a tab that isn't compositing, a browser
 * throttling background work — the value is set outright rather than left at
 * zero. A countdown that reads "0 days to race" is worse than one that appears
 * without its animation.
 */
export function Counter({
  to,
  decimals = 0,
  suffix = "",
  prefix = "",
  duration = 1400,
  className = "",
}: {
  to: number;
  decimals?: number;
  suffix?: string;
  prefix?: string;
  duration?: number;
  className?: string;
}) {
  const [value, setValue] = useState(0);

  const ref = useOnVisible<HTMLSpanElement>(() => {
    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduced || typeof requestAnimationFrame === "undefined") {
      setValue(to);
      return;
    }

    let frames = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      frames++;
      const p = Math.min(1, (now - t0) / duration);
      setValue(to * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);

    // If the animation hasn't produced frames well past its own duration, the
    // page isn't painting. Land on the real number.
    window.setTimeout(() => {
      if (frames < 2) setValue(to);
    }, duration + 600);
  }, 0.35);

  return (
    <span ref={ref} className={`tabular-nums ${className}`}>
      {prefix}
      {value.toLocaleString("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
      {suffix}
    </span>
  );
}

/**
 * The hero's rotating sport. Only the top word changes; the three below stay
 * put, so the eye reads one substitution rather than a list reshuffling.
 */
export function Cycler({ words, className = "" }: { words: string[]; className?: string }) {
  const [i, setI] = useState(0);
  const [out, setOut] = useState(false);

  useEffect(() => {
    if (words.length < 2) return;
    const id = window.setInterval(() => {
      setOut(true);
      // Swap at the midpoint of the exit, while the word is invisible.
      window.setTimeout(() => {
        setI((n) => (n + 1) % words.length);
        setOut(false);
      }, 450);
    }, 2600);
    return () => window.clearInterval(id);
  }, [words.length]);

  return (
    <span
      className={`block transition-[opacity,transform] duration-[450ms] ease-[cubic-bezier(.2,.8,.2,1)] ${className}`}
      style={{ opacity: out ? 0 : 1, transform: out ? "translateY(-32%)" : "none" }}
    >
      {words[i]}
    </span>
  );
}
