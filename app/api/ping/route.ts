// TEMPORARY diagnostic endpoint — safe to delete (the whole app/api/ping folder).
// Measures request round trip only: no database, no session, no app imports.

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
