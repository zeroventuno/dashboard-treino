"use client";

// Scroll reveal for the landing page.
//
// IntersectionObserver rather than a scroll listener: the browser does the work
// off the main thread, so a long marketing page doesn't stutter on a phone.
// Elements are released once and the observer stops watching them — content
// that fades out again when you scroll back up reads as a bug, not a flourish.
import { useEffect, useRef, type ReactNode } from "react";

export function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: ReactNode;
  /** Milliseconds after the element enters view. Stagger a row with 0/80/160. */
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const show = () => {
      el.style.transitionDelay = `${delay}ms`;
      el.classList.add("ld-in");
    };

    // Already on screen at mount — the hero, above all. Reveal from geometry
    // instead of waiting for an observer callback: nothing above the fold
    // should depend on an async notification that may never arrive.
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom > 0) {
      show();
      return;
    }

    if (typeof IntersectionObserver === "undefined") {
      show();
      return;
    }

    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        show();
        io.disconnect();
      },
      // Fire slightly before the element is fully on screen, so the motion has
      // finished by the time the reader's eye arrives.
      { rootMargin: "0px 0px -12% 0px", threshold: 0.12 },
    );
    io.observe(el);

    // Last resort. These elements start at opacity 0, so anything that stops
    // the observer from ever firing — a browser that throttles offscreen work,
    // a tab restored from bfcache, an engine quirk — would leave a marketing
    // page silently blank. Copy that no one can read is worse than copy that
    // arrives without its animation.
    const failsafe = window.setTimeout(show, 2500);

    return () => {
      io.disconnect();
      window.clearTimeout(failsafe);
    };
  }, [delay]);

  return (
    <div ref={ref} className={`ld-reveal ${className}`}>
      {children}
    </div>
  );
}
