"use client";

import { Component, type ReactNode } from "react";
import { translator, type Locale } from "@/lib/i18n";

/**
 * Keeps one broken block from taking the page with it.
 *
 * The dashboard is a column of independent cards, but React doesn't know that:
 * an exception thrown while rendering any one of them unmounts the whole tree,
 * and the athlete gets a blank page with no explanation. That is exactly what
 * happened when a single session was saved with an unrecognised discipline —
 * the calendar threw, and the hero, the fitness chart and everything else went
 * with it, none of which had anything to do with that workout.
 *
 * Validation stops the causes we've thought of. This stops the ones we haven't:
 * whatever a coach writes, the damage is now one card instead of the product.
 */

interface Props {
  children: ReactNode;
  locale: Locale;
  /** Identifies the block in the console so a report names the culprit. */
  id: string;
}

export class BlockBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    // The athlete sees a calm card; whoever is debugging gets the stack.
    console.error(`[block:${this.props.id}]`, error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const tr = translator(this.props.locale);

    return (
      <div className="rounded-[var(--radius)] border border-[var(--border-soft)] bg-[var(--surface)] p-6 text-center">
        <p className="text-[13px] font-semibold text-[var(--text-muted)]">{tr("block.failed")}</p>
        <p className="mt-1 text-[12px] leading-relaxed text-[var(--text-faint)]">{tr("block.failed.hint")}</p>
      </div>
    );
  }
}
