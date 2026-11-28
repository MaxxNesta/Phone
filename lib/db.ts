import postgres from "postgres";

declare global {
  // eslint-disable-next-line no-var
  var __sql: ReturnType<typeof postgres> | undefined;
}

function connect() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const isLocal = url.includes("localhost") || url.includes("127.0.0.1");

  // Neon's pooled endpoint is PgBouncer in transaction mode, which does not
  // support prepared statements. postgres.js prepares by default, so every
  // query would fail against a pooled URL unless this is turned off.
  const isPooled = url.includes("-pooler.") || url.includes("pgbouncer=true");

  return postgres(url, {
    // A single connection serialises everything: a page firing six queries
    // through Promise.all would wait for six sequential round trips rather
    // than one. Pooled endpoints sit behind PgBouncer and handle far more
    // than this, so the small pool only ever cost latency.
    max: isPooled ? 8 : process.env.VERCEL ? 3 : 5,
    idle_timeout: 20,
    connect_timeout: 10,
    ssl: isLocal ? false : "require",
    prepare: !isPooled,
    onnotice: () => {},
    transform: { undefined: null },
    types: {
      // postgres.js turns every value bound to a date or timestamp into
      // new Date(x).toISOString(), which throws on a date like "ZAP" from a
      // link. Thrown there, mid-way through the server's replies, it drops the
      // rest of them and the connection reads every later answer as the wrong
      // query's (found by the ZAP scan, 2026-11-28: other pages got another
      // query's rows, then the pool hung). An invalid date goes to Postgres as
      // typed instead, which refuses it with an ordinary error. Parsing is the
      // library's own.
      date: {
        to: 1184,
        from: [1082, 1114, 1184],
        serialize: (x: unknown) => {
          const d = x instanceof Date ? x : new Date(x as string);
          return Number.isNaN(d.getTime()) ? String(x) : d.toISOString();
        },
        parse: (x: string) => new Date(x),
      },
    },
  });
}

// Reuse across hot reloads in development.
export const sql = global.__sql ?? connect();
if (process.env.NODE_ENV !== "production") global.__sql = sql;

// Re-exported so the many pages importing these from "@/lib/db" keep working.
// New code should import from "@/lib/format" directly.
export { money, moneyOrTrace, qty, shortDate, dateTime, timeOfDay, timeAgo, DISPLAY_TZ } from "./format";
