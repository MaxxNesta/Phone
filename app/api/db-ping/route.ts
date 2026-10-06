// TEMPORARY diagnostic endpoint — safe to delete (the whole app/api/db-ping folder).
// Times one `SELECT 1` through the app's own database client (lib/db.ts), so
// the figure includes the same pool, TLS and pooler the ERP pages use.

import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const started = performance.now();
  try {
    await sql`select 1`;
    const dbMs = Math.round((performance.now() - started) * 10) / 10;
    return Response.json({ ok: true, dbMs }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const dbMs = Math.round((performance.now() - started) * 10) / 10;
    return Response.json(
      { ok: false, dbMs, error: e instanceof Error ? e.message : String(e) },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
