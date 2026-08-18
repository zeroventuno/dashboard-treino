// Owner-only administration: who owns the agency, what each professional
// programs, who looks after which athlete, and what an athlete is worth monthly.
//
// All of it is gated on `isOwner` rather than on the coach role. A coach runs
// their own roster; deciding another professional's book — or seeing what the
// agency charges — is an ownership decision, and a nutritionist who owns the
// place should be able to do it while a hired coach should not.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  resolveStaffId, updateStaff, updateAgencyAthlete, createAthlete, updateAgencySettings,
} from "@/lib/product-db";
import { COACH_COOKIE } from "@/app/api/coach-login/route";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SPORTS = ["swim", "bike", "run", "strength"];
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const str = (v: unknown, max = 120) => (typeof v === "string" ? v.trim().slice(0, max) : undefined);

export async function POST(req: Request) {
  const key = (await cookies()).get(COACH_COOKIE)?.value;
  const staff = key ? await resolveStaffId(key) : null;
  if (!staff) return NextResponse.json({ ok: false, code: "unauthorized" }, { status: 401 });
  if (!staff.isOwner) return NextResponse.json({ ok: false, code: "not_owner" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ ok: false, code: "bad_request" }, { status: 400 });

  // Creating an athlete is the one action with no `id` yet — it mints one.
  if (body.kind === "newAthlete") {
    const name = str(body.name);
    const email = str(body.email, 160)?.toLowerCase();
    if (!name || !email || !EMAIL.test(email)) {
      return NextResponse.json({ ok: false, code: "bad_request" }, { status: 400 });
    }
    const res = await createAthlete(staff.agencyId, {
      name,
      email,
      nickname: str(body.nickname, 60),
      phone: str(body.phone, 40),
    });
    // Post the welcome email, key included, at the ONE moment the key exists in
    // plaintext. Until now the owner had to copy it off the screen and send it
    // themselves, which is why athletes were invited and never activated.
    //
    // Deliberately after the athlete is created and deliberately unable to fail
    // it: the account is the thing that matters, the email is a convenience,
    // and an SMTP hiccup must not cost someone their registration. The key is
    // still returned and still shown on screen, so a failed send degrades to
    // exactly the behaviour that existed before.
    let mailed = false;
    if (res.ok) {
      const origin = process.env.APP_ORIGIN?.trim().replace(/\/+$/, "");
      const hook = process.env.N8N_MAIL_WEBHOOK_URL?.trim();
      if (origin && hook) {
        mailed = await fetch(hook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: "welcome",
            // A marca viaja com a mensagem: o mailer no n8n serve todos os
            // projetos da Ventuno pelo mesmo remetente autenticado, e cada um
            // manda a propria identidade em vez de existir um fluxo por projeto.
            brand: process.env.MAIL_BRAND ?? "MY TRAKR",
            // HTML cru, colado no rodape. Fica em env para a assinatura poder
            // mudar sem deploy — e para cada projeto Ventuno mandar a sua sem
            // que exista um fluxo n8n por projeto.
            signature: process.env.MAIL_SIGNATURE ?? "",
            email,
            name,
            // A magic link: logging in IS the first step, and asking someone to
            // paste a key before they have seen anything is where they give up.
            url: `${origin}/app?key=${encodeURIComponent(res.key)}`,
          }),
        })
          .then((r) => r.ok)
          .catch(() => false);
      }
    }

    // The key travels back exactly once — it is not stored in plaintext, so a
    // reload can never show it again. `mailed` tells the panel whether to say
    // "sent" or to keep insisting the owner copies it: claiming an email went
    // out when it didn't is how an athlete ends up waiting for nothing.
    return NextResponse.json(
      res.ok ? { ...res, mailed } : res,
      { status: res.ok ? 200 : res.code === "duplicate_email" ? 409 : 503 },
    );
  }

  // Agency settings carry no `id` either, and must not: the agency edited is
  // ALWAYS the session's own (`staff.agencyId`). Accepting one from the body
  // would be handing the owner of one agency the key to another's row.
  //
  // Both fields are refused rather than coerced when unrecognised — a currency
  // Intl doesn't know throws mid-render, and a zone nobody can resolve moves
  // every date in the panel by a day while still looking like a fact. The
  // validation itself lives with the values (lib/currencies, lib/agency-clock)
  // so the picker and the write path can never drift apart.
  if (body.kind === "agency") {
    const patch: { currency?: string; timezone?: string } = {};
    if ("currency" in body) patch.currency = String(body.currency ?? "");
    if ("timezone" in body) patch.timezone = String(body.timezone ?? "");
    const res = await updateAgencySettings(staff.agencyId, patch);
    return NextResponse.json(res, { status: res.ok ? 200 : res.code === "not_found" ? 404 : 400 });
  }

  const target = typeof body.id === "string" && UUID.test(body.id) ? body.id : null;
  if (!target) return NextResponse.json({ ok: false, code: "bad_request" }, { status: 400 });

  if (body.kind === "staff") {
    const patch: { isOwner?: boolean; sports?: string[] } = {};
    if (typeof body.isOwner === "boolean") patch.isOwner = body.isOwner;
    if (Array.isArray(body.sports)) patch.sports = body.sports.filter((s) => SPORTS.includes(String(s)));
    const res = await updateStaff(staff.agencyId, target, patch);
    // Removing the last owner would lock the agency out of its own admin.
    return NextResponse.json(res, { status: res.ok ? 200 : res.code === "last_owner" ? 409 : 404 });
  }

  if (body.kind === "athlete") {
    const patch: {
      monthlyValue?: number | null; extrasValue?: number | null;
      staffIds?: string[]; name?: string; nickname?: string; phone?: string;
    } = {};
    if ("monthlyValue" in body) {
      const v = body.monthlyValue;
      // "" clears the price; anything unparseable is rejected rather than
      // silently stored as 0, which would understate the book.
      if (v === null || v === "") patch.monthlyValue = null;
      else {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0) {
          return NextResponse.json({ ok: false, code: "bad_value" }, { status: 400 });
        }
        patch.monthlyValue = n;
      }
    }
    if ("extrasValue" in body) {
      const v = body.extrasValue;
      if (v === null || v === "") patch.extrasValue = null;
      else {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0) {
          return NextResponse.json({ ok: false, code: "bad_value" }, { status: 400 });
        }
        patch.extrasValue = n;
      }
    }
    if (Array.isArray(body.staffIds)) {
      patch.staffIds = body.staffIds.filter((s): s is string => typeof s === "string" && UUID.test(s));
    }
    if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim().slice(0, 120);
    // These two accept "" on purpose — that's how the owner clears them.
    if (typeof body.nickname === "string") patch.nickname = body.nickname.trim().slice(0, 60);
    if (typeof body.phone === "string") patch.phone = body.phone.trim().slice(0, 40);

    const ok = await updateAgencyAthlete(staff.agencyId, target, patch);
    return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
  }

  return NextResponse.json({ ok: false, code: "bad_request" }, { status: 400 });
}
