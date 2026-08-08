// Is the product database reachable from this deployment?
//
// Exists because a dead connection was indistinguishable from a bad account key
// in the UI, so there was no way to tell "your key is wrong" from "the database
// is down" without shell access to the pool.
//
// Deliberately says nothing about *which* database: no host, no user, no
// connection string — only whether a trivial query succeeds, and the driver's
// error code when it doesn't (`28P01` bad password, `ETIMEDOUT`, `ENOTFOUND`…).
// Row counts are per-deployment health, not tenant data.

import { NextResponse } from "next/server";
import { hasProductDb, healthCheck, schemaCheck } from "@/lib/product-db";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!hasProductDb()) {
    return NextResponse.json({ db: "not_configured" }, { status: 503 });
  }

  const started = Date.now();
  const result = await healthCheck();
  const ms = Date.now() - started;

  if (!result.ok) {
    return NextResponse.json({ db: "unreachable", code: result.code, ms }, { status: 503 });
  }

  // Reachable but blind: every key will fail to resolve, so this is an outage,
  // not a healthy deployment that happens to have no accounts.
  if (result.rlsHidingRows) {
    return NextResponse.json(
      {
        db: "ok",
        tenants: 0,
        problem: "rls_hiding_rows",
        fix: "alter table app.tenants disable row level security;",
        ms,
      },
      { status: 503 },
    );
  }

  // Reachable and populated, but a migration this build depends on hasn't been
  // run: every read that touches the missing column throws, the dashboard falls
  // back to sample data, and it reads as lost data. Fail loudly here so a deploy
  // can be verified before anyone opens the app and panics.
  const missing = await schemaCheck();
  if (missing.length > 0) {
    return NextResponse.json(
      {
        db: "ok",
        tenants: result.tenants,
        problem: "missing_migration",
        missing,
        fix: `Run in the product project's SQL Editor: ${[...new Set(missing.map((m) => m.migration))].join(", ")}`,
        ms,
      },
      { status: 503 },
    );
  }

  return NextResponse.json({ db: "ok", tenants: result.tenants, ms }, { status: 200 });
}
