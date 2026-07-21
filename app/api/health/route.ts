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
import { hasProductDb, healthCheck } from "@/lib/product-db";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!hasProductDb()) {
    return NextResponse.json({ db: "not_configured" }, { status: 503 });
  }

  const started = Date.now();
  const result = await healthCheck();
  const ms = Date.now() - started;

  return NextResponse.json(
    result.ok
      ? { db: "ok", tenants: result.tenants, ms }
      : { db: "unreachable", code: result.code, ms },
    { status: result.ok ? 200 : 503 },
  );
}
