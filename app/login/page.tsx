"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const params = useSearchParams();
  const from = params.get("from") || "/";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const json = await res.json();
      if (json.ok) {
        router.replace(from);
        router.refresh();
      } else {
        setError(json.error || "Senha incorreta.");
      }
    } catch {
      setError("Erro de conexão.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="pop w-full max-w-sm rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-7 shadow-[var(--shadow)]">
      <div className="mb-6">
        <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--lime)]">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--lime)]" />
          TRAK · Costa Navarino 70.3
        </p>
        <h1 className="mt-2 text-2xl font-extrabold text-[var(--text)]">Training dashboard</h1>
        <p className="mt-1 text-[13px] text-[var(--text-muted)]">Enter the password to continue.</p>
      </div>

      <input
        type="password"
        autoFocus
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg-soft)] px-4 py-3 text-[var(--text)] outline-none transition-colors placeholder:text-[var(--text-faint)] focus:border-[var(--lime)]"
      />
      {error && <p className="mt-2 text-[13px] text-[var(--bad)]">{error}</p>}

      <button
        type="submit"
        disabled={busy}
        className="mt-4 w-full rounded-xl bg-[var(--lime)] px-4 py-3 text-sm font-bold text-black transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {busy ? "Signing in…" : "Enter"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
