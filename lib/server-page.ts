import type { DataRow } from "@/components/data-table";
import { dateWindow, type DateRange } from "@/lib/date-range";

/**
 * One page of a long list, cut on the server.
 *
 * A DataTable in client mode is handed every row and pages them in the
 * browser, which means every row's markup is rendered and sent: a till's
 * invoice list grows by thousands a month, and the whole of it went out on
 * every visit to show twenty. This applies what the table's server mode writes
 * to the address (q, f_<key>, sort, dir, page, size) to rows the page has
 * already built, and returns only the page's rows to render, with the `server`
 * prop that tells the table so. Same search, filter and sort rules as the
 * client mode; the stock list (app/items/stock) does the same inline.
 */
export function serverPage(
  rows: DataRow[],
  sp: Record<string, string | undefined>,
  defaultSort: { key: string; dir: "asc" | "desc" },
  dateKey = "posting_date",
) {
  const needle = (sp.q ?? "").trim().toLowerCase();
  const filters = Object.fromEntries(Object.entries(sp)
    .filter(([k, v]) => k.startsWith("f_") && v).map(([k, v]) => [k.slice(2), v as string]));
  // The date window, as the table's date filter writes it (dp, dfrom, dto),
  // over the same sort key the client mode reads.
  const dates: DateRange = { preset: (sp.dp ?? "") as DateRange["preset"], from: sp.dfrom ?? "", to: sp.dto ?? "" };
  const window = dateWindow(dates);
  const matched = rows.filter((r) => {
    if (needle && !(r.searchText ?? "").toLowerCase().includes(needle)) return false;
    if (window) {
      const t = r.sort?.[dateKey];
      if (typeof t !== "number" || t <= 0 || t < window[0] || t >= window[1]) return false;
    }
    // Equal, or one of a multi filter's comma-joined values (components/data-table facetMatches).
    return Object.entries(filters).every(([k, v]) => v === r.facet?.[k]
      || (v.includes(",") && r.facet?.[k] !== undefined && v.split(",").includes(r.facet[k])));
  });

  const known = sp.sort && rows.some((r) => r.sort && sp.sort! in r.sort);
  const key = known ? sp.sort! : defaultSort.key;
  const dir: "asc" | "desc" = known ? (sp.dir === "desc" ? "desc" : "asc") : defaultSort.dir;
  matched.sort((a, b) => {
    const x = a.sort?.[key] ?? "", y = b.sort?.[key] ?? "";
    const k = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
    return dir === "asc" ? k : -k;
  });

  const pageSize = [10, 20, 50, 100].includes(Number(sp.size)) ? Number(sp.size) : 20;
  const pageCount = Math.max(1, Math.ceil(matched.length / pageSize));
  const page = Math.min(pageCount, Math.max(1, Math.floor(Number(sp.page)) || 1));
  return {
    rows: matched.slice((page - 1) * pageSize, page * pageSize),
    server: { total: matched.length, page, pageSize, q: sp.q ?? "", sort: known ? { key, dir } : null, filters, dates },
  };
}
