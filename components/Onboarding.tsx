"use client";

import { useRef, useState } from "react";
import { translator, type Locale, type TKey } from "@/lib/i18n";
import { coachBriefing } from "@/lib/coach-briefing";

/** First screen of a brand-new account.
 *
 * A tenant with no profile and no data would otherwise render eight empty
 * blocks — a dashboard that looks broken rather than new. This says what to do
 * instead, and disappears on its own as soon as the coach writes anything.
 *
 * The connector setup is the one genuinely hard step, and it differs per app,
 * so it's spelled out per client rather than described in general terms. Every
 * client here speaks HTTP directly: no terminal, no Node, just the URL. */

// `icon` is a black-on-transparent raster used as a CSS mask, not an <img>: the
// tab flips text colour on active/inactive, and a mask painted with currentColor
// flips with it (dark on the lime active pill, muted otherwise). Claude Desktop
// and Claude Code share the Anthropic mark.
const CLIENTS = [
  { id: "claude", label: "Claude Desktop", icon: "/logo-claude.png", steps: ["onboarding.claude.1", "onboarding.claude.2", "onboarding.claude.3"] },
  { id: "chatgpt", label: "ChatGPT", icon: "/logo-chatgpt.webp", steps: ["onboarding.chatgpt.1", "onboarding.chatgpt.2", "onboarding.chatgpt.3"] },
  { id: "code", label: "Claude Code", icon: "/logo-claude.png", steps: ["onboarding.code.1", "onboarding.code.2"] },
] as const satisfies readonly { id: string; label: string; icon: string; steps: readonly TKey[] }[];

/** A brand mark that inherits the button's text colour. Uses the image's alpha
 * as a mask, so it works for any monochrome-on-transparent logo. */
function BrandMark({ src }: { src: string }) {
  return (
    <span
      aria-hidden
      className="inline-block h-[14px] w-[14px] shrink-0"
      style={{
        backgroundColor: "currentColor",
        WebkitMaskImage: `url(${src})`,
        maskImage: `url(${src})`,
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
      }}
    />
  );
}

function CopyField({
  value,
  copyLabel,
  copiedLabel,
  selectLabel,
  hideValue = false,
}: {
  value: string;
  copyLabel: string;
  copiedLabel: string;
  selectLabel: string;
  /** The briefing is already shown above in its own scroll box; repeating it
   * inside the field would be absurd. The hidden copy still backs the manual
   * Ctrl+C fallback when the clipboard is refused. */
  hideValue?: boolean;
}) {
  const [state, setState] = useState<"idle" | "copied" | "selected">("idle");
  const ref = useRef<HTMLElement>(null);

  /** Select the text so Ctrl+C still works. The Clipboard API can refuse with
   * NotAllowedError even in a secure context, and a button that silently does
   * nothing is worse than no button — this athlete has to get the URL across
   * somehow, and retyping a 53-character key is how keys get typed wrong. */
  function selectText() {
    const node = ref.current;
    if (!node) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    setState("selected");
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
      setTimeout(() => setState("idle"), 2000);
    } catch {
      selectText();
    }
  }

  const label = state === "copied" ? copiedLabel : state === "selected" ? selectLabel : copyLabel;
  const done = state !== "idle";

  return (
    <div className="mt-2 flex items-stretch gap-2">
      <code
        ref={ref}
        onClick={selectText}
        className={
          hideValue
            ? "sr-only"
            : "min-w-0 flex-1 cursor-pointer select-all break-all rounded-[10px] border border-[var(--border)] bg-[var(--bg-soft)] px-3 py-2 font-mono text-[11.5px] leading-relaxed text-[var(--text-muted)]"
        }
      >
        {value}
      </code>
      <button
        type="button"
        onClick={copy}
        className="shrink-0 self-start rounded-[10px] border px-3 py-2 text-[11.5px] font-bold transition-colors"
        style={{
          borderColor: done ? "var(--good)" : "var(--lime)",
          background: done ? "transparent" : "var(--lime)",
          color: done ? "var(--good)" : "#0a0b0d",
        }}
      >
        {label}
      </button>
    </div>
  );
}

export function Onboarding({
  locale,
  athlete,
  connectorUrl,
}: {
  locale: Locale;
  athlete: string | null;
  connectorUrl: string;
}) {
  const tr = translator(locale);
  const [client, setClient] = useState<(typeof CLIENTS)[number]["id"]>("claude");
  const active = CLIENTS.find((c) => c.id === client) ?? CLIENTS[0];

  // Claude Code takes the URL as a terminal argument, not pasted into a field.
  const codeCommand = `claude mcp add --transport http trak-coach "${connectorUrl}"`;
  const briefing = coachBriefing(locale);

  return (
    <div className="mx-auto max-w-[680px] py-8">
      <div className="rounded-[var(--radius)] border border-[var(--border-soft)] bg-[var(--surface)] p-7 shadow-[var(--shadow)] sm:p-9">
        <h1 className="dsp text-[26px] font-extrabold text-[var(--text)]">
          {athlete ? `${tr("onboarding.welcome")}, ${athlete}` : tr("onboarding.welcome")}
        </h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--text-muted)]">
          {tr("onboarding.intro")}
        </p>

        {/* 1 — already done, just so the list starts with a win */}
        <div className="mt-7 flex gap-3.5">
          <span className="mt-[2px] grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--lime)] text-[11px] font-bold text-[#0a0b0d]">
            ✓
          </span>
          <p className="text-[14px] font-semibold text-[var(--text)]">{tr("onboarding.step1")}</p>
        </div>

        {/* 2 — the hard one: connect the coach */}
        <div className="mt-6 flex gap-3.5">
          <span className="mt-[2px] grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--surface-3)] text-[11px] font-bold text-[var(--text-faint)]">
            2
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold text-[var(--text)]">{tr("onboarding.step2")}</p>
            <p className="mt-1 text-[12.5px] text-[var(--text-faint)]">{tr("onboarding.step2.pick")}</p>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {CLIENTS.map((c) => {
                const on = c.id === client;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setClient(c.id)}
                    className="flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[12px] font-semibold transition-colors"
                    style={{
                      borderColor: on ? "var(--lime)" : "var(--border)",
                      background: on ? "var(--lime)" : "transparent",
                      color: on ? "#0a0b0d" : "var(--text-muted)",
                    }}
                  >
                    <BrandMark src={c.icon} />
                    {c.label}
                  </button>
                );
              })}
            </div>

            <ol className="mt-4 space-y-2.5">
              {active.steps.map((k, i) => (
                <li key={k} className="flex gap-2.5 text-[13px] leading-relaxed text-[var(--text-2)]">
                  <span className="tnum shrink-0 font-semibold text-[var(--text-faint)]">{i + 1}.</span>
                  <span className="min-w-0">{tr(k)}</span>
                </li>
              ))}
            </ol>

            <CopyField
              value={client === "code" ? codeCommand : connectorUrl}
              copyLabel={tr("onboarding.copy")}
              copiedLabel={tr("onboarding.copied")}
              selectLabel={tr("onboarding.selected")}
            />

            <p className="mt-2 text-[11.5px] leading-relaxed text-[var(--text-faint)]">
              {tr("onboarding.secret")}
            </p>
          </div>
        </div>

        {/* 3 — the briefing. A bare question ("list my devices") pasted into a
            fresh chat tells the model nothing: not that the TRAK tools exist,
            not to read before writing, not what any of the fields mean. This
            block is what actually turns a general assistant into the coach. */}
        <div className="mt-6 flex gap-3.5">
          <span className="mt-[2px] grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--surface-3)] text-[11px] font-bold text-[var(--text-faint)]">
            3
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold text-[var(--text)]">{tr("onboarding.step3")}</p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--text-faint)]">
              {tr("onboarding.step3.why")}
            </p>

            <div className="mt-3 max-h-[220px] overflow-y-auto rounded-[10px] border border-[var(--border)] bg-[var(--bg-soft)] px-3 py-2.5">
              <pre className="whitespace-pre-wrap break-words font-sans text-[12px] leading-relaxed text-[var(--text-muted)]">
                {briefing}
              </pre>
            </div>

            <CopyField
              value={briefing}
              copyLabel={tr("onboarding.copyBriefing")}
              copiedLabel={tr("onboarding.copied")}
              selectLabel={tr("onboarding.selected")}
              hideValue
            />
          </div>
        </div>

        <p className="mt-7 border-t border-[var(--border)] pt-5 text-[12.5px] leading-relaxed text-[var(--text-faint)]">
          {tr("onboarding.footer")}
        </p>
      </div>
    </div>
  );
}
