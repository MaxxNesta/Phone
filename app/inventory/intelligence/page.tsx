import { BranchScope } from "@/components/branch-scope";
import { seenRows, seenLocations, scopedBranch } from "@/lib/branch-scope";
import Link from "next/link";
import { money, qty as fmtQty, shortDate } from "@/lib/db";
import {
  getCompany, getVariantProfitability, getVariantStock, getInventoryAging,
  getMatchedProfitability, getLocations,
} from "@/lib/queries";
import { AccountPicker } from "@/components/account-picker";
import { VariantTags, asVariant } from "@/components/variant-tags";
import { ItemThumb } from "@/components/item-thumb";
import { variantPhotos } from "@/lib/variants";
import { HelpHint } from "@/components/help-hint";
import { getTranslations } from "next-intl/server";

/**
 * What the stock is doing for the business, as against where it is.
 *
 * Two questions that share a page because they are the same conversation:
 * which products earn their shelf space, and which have been sitting on it.
 * Neither belongs on the stock screens — those answer "what have I got",
 * and a manager deciding what to buy and what to discount is asking
 * something else.
 *
 * Every figure is derived at read time and ties to the ledger. Nothing here
 * is a stored metric, so nothing here can drift from the books.
 */

const TABS = [
  { key: "matched" },
  { key: "period" },
  { key: "aging" },
] as const;

/**
 * Whether any row in this table has a picture at all.
 *
 * The thumbnail column is 25px of nothing in a catalogue nobody has
 * photographed, and a column of empty boxes reads as a page that failed to
 * load rather than as a catalogue without photos. When one row has a photo
 * the column earns its place for all of them; when none does, it goes.
 */
const anyPhoto = (ids: string[], srcOf: (id: string) => string | null) =>
  ids.some((id) => srcOf(id) !== null);

/** Only a real date gets through; anything else is treated as not set. */
const asDate = (v: string | undefined) =>
  v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;

/**
 * Where a figure came from.
 *
 * The stock card is the right destination for all three reports: it is the
 * ledger these are summaries of, so "why is this number what it is" is
 * answered by the rows behind it rather than by another summary.
 */
function ItemLink({ id, code, title }: { id: string; code: string; title: string }) {
  return (
    <Link href={`/inventory/movements?item=${id}`} className="m"
          style={{ color: "var(--link)" }} title={title}>
      {code}
    </Link>
  );
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

export default async function InventoryIntelligence({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; from?: string; to?: string;
                          location?: string }>;
}) {
  const sp = await searchParams;
  const t = await getTranslations("inventory");
  const c = await getTranslations("common");
  const n = await getTranslations("nav");
  const company = await getCompany();
  if (!company) return <div className="empty">{c("noCompany")}</div>;

  const tab = TABS.some((t) => t.key === sp.tab) ? sp.tab! : "matched";

  const locations = (await seenRows((await getLocations(company.id)) as unknown as Record<string, unknown>[], "id")) as unknown as any[];
  const warehouses = locations.filter((l) => l.is_stock_location);
  // Someone who sees only their own branch has no "all": their branch's
  // warehouse is the whole of what they may read.
  const limited = (await seenLocations()) !== null;
  const chosen = sp.location && warehouses.some((l) => l.id === sp.location)
    ? sp.location : limited ? (warehouses[0]?.id ?? "none") : "all";
  const locationId = chosen === "all" ? null : chosen === "none" ? "00000000-0000-0000-0000-000000000000" : chosen;

  const exportHref = (() => {
    const q = new URLSearchParams();
    q.set("tab", tab);
    if (asDate(sp.from)) q.set("from", sp.from!);
    if (asDate(sp.to)) q.set("to", sp.to!);
    if (locationId) q.set("location", locationId);
    return `/inventory/intelligence/export?${q.toString()}`;
  })();

  /*
   * A year to today, unless asked otherwise. Long enough that a seasonal
   * product is not judged on a quiet fortnight.
   *
   * The end is clamped to today and never accepts a future date. Nothing in
   * the ledger is dated ahead — the movement trigger from 0102 refuses it —
   * so a range running into next year adds nothing but a figure somebody
   * might read as a forecast. When a later date is asked for, the page says
   * it was pulled back rather than silently using a different window than
   * the one on screen.
   */
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const asked = asDate(sp.to);
  const clamped = asked !== null && asked > todayIso;
  // Exclusive upper bound, so "to today" includes everything posted today.
  const toShown = clamped || asked === null ? todayIso : asked;
  const to = new Date(new Date(toShown).getTime() + 86400000).toISOString().slice(0, 10);
  const from = asDate(sp.from)
    ?? new Date(today.getTime() - 365 * 86400000).toISOString().slice(0, 10);

  const href = (tabKey: string) => {
    const q = new URLSearchParams();
    if (tabKey !== "matched") q.set("tab", tabKey);
    if (asDate(sp.from)) q.set("from", sp.from!);
    if (asDate(sp.to)) q.set("to", sp.to!);
    if (locationId) q.set("location", locationId);
    const s = q.toString();
    return `/inventory/intelligence${s ? `?${s}` : ""}`;
  };

  return (
    <>
      <div className="page-head">
        <span className="eyebrow">{n("inventory")}</span>
        <h1>{t("int.title")}</h1>
        <BranchScope />
        <HelpHint>
          {t("int.help")}
        </HelpHint>
      </div>

      <div className="scopetabs viewtabs">
        {TABS.map((tb) => (
          <Link key={tb.key} className="scopetab" data-active={tab === tb.key}
                href={href(tb.key)}>
            {t(`int.tab.${tb.key}`)}
          </Link>
        ))}
      </div>

      <div className="filterbar">
        {warehouses.length > 1 && (
          <AccountPicker
            accounts={[{ id: "all", code: "\u2014", name: t("sum.allWarehouses") }, ...warehouses]}
            selectedId={chosen}
            basePath="/inventory/intelligence"
            paramName="location"
            label={c("warehouse")}
            keep={{ tab: tab === "matched" ? undefined : tab,
                    from: asDate(sp.from) ?? undefined,
                    to: asDate(sp.to) ?? undefined }}
          />
        )}
      {tab !== "aging" && (
      <form method="get" action="/inventory/intelligence" className="daterange">
        {tab !== "matched" && <input type="hidden" name="tab" value={tab} />}
        <div className="field">
          <label htmlFor="from">{c("from")}</label>
          <input id="from" name="from" type="date" defaultValue={from}
                 max={todayIso} />
        </div>
        <div className="field">
          <label htmlFor="to">{c("to")}</label>
          <input id="to" name="to" type="date" defaultValue={toShown}
                 max={todayIso} />
          {clamped && (
            <span className="hint" style={{ color: "var(--warn)" }}>
              {t("int.pulledBack")}
            </span>
          )}
        </div>
        {locationId && <input type="hidden" name="location" value={locationId} />}
        <button type="submit" className="btn ghost">{c("apply")}</button>
      </form>
      )}

        {/* The same queries, as a file — so it cannot disagree with the
            screen it was downloaded from. */}
        <div className="field exportfield">
          <label>&nbsp;</label>
          <Link className="btn ghost" href={exportHref}>{t("int.exportCsv")}</Link>
        </div>
      </div>

      {tab === "matched" ? <Matched companyId={company.id} from={from} to={to} shown={toShown}
                  locationId={locationId} />
       : tab === "period" ? <Profitability companyId={company.id} from={from} to={to}
                  shown={toShown} locationId={locationId} />
       : <Aging companyId={company.id} locationId={locationId} />}
    </>
  );
}

async function Profitability({
  companyId, from, to, shown, locationId,
}: { companyId: string; from: string; to: string; shown: string;
     locationId: string | null }) {
  const t = await getTranslations("inventory");
  const [rows, variantStock] = await Promise.all([
    getVariantProfitability(companyId, from, to, locationId) as unknown as Promise<any[]>,
    getVariantStock(companyId) as unknown as Promise<any[]>,
  ]);

  const photos = variantPhotos(variantStock as never);
  const srcOf = (id: string) => {
    const v = variantStock.find((x) => x.id === id);
    return v ? photos.srcFor(v as never) : null;
  };
  const showThumbs = anyPhoto(rows.map((r: any) => r.id), srcOf);

  const revenue = rows.reduce((acc, r) => acc + Number(r.revenue), 0);
  const cogs = rows.reduce((acc, r) => acc + Number(r.cogs), 0);
  const margin = revenue - cogs;

  /**
   * Billed and shipped in different windows.
   *
   * Revenue is recognised by the invoice and cost by the delivery, and the
   * two are not always the same document or even the same month. Counted
   * and said out loud, because a margin computed across a mismatch is not
   * wrong so much as answering a slightly different question.
   */
  const mismatched = rows.filter(
    (r) => Math.abs(Number(r.qty_sold) - Number(r.qty_shipped)) > 0.0001).length;

  if (rows.length === 0) {
    return (
      <div className="empty">
        {t("int.nothingSold")}
      </div>
    );
  }

  return (
    <>
      <div className="kpis kpis-tiled">
        <div className="kpi">
          <span className="kpi-body">
            <span className="kpi-label">{t("int.revenue")}</span>
            <span className="kpi-value">{money(revenue)}</span>
            <span className="kpi-note">{t("int.invoicedPeriod")}</span>
          </span>
        </div>
        <div className="kpi">
          <span className="kpi-body">
            <span className="kpi-label">{t("int.costOfGoods")}</span>
            <span className="kpi-value">{money(cogs)}</span>
            <span className="kpi-note">{t("int.releasedLedger")}</span>
          </span>
        </div>
        <div className="kpi">
          <span className="kpi-body">
            <span className="kpi-label">{t("int.grossMargin")}</span>
            <span className="kpi-value" style={{ color: margin < 0 ? "var(--bad)" : undefined }}>
              {money(margin)}
            </span>
            <span className="kpi-note">
              {revenue > 0 ? t("int.pctRevenue", { pct: pct(margin / revenue) }) : t("int.noRevenue")}
            </span>
          </span>
        </div>
      </div>

      {mismatched > 0 && (
        <div className="card" style={{ marginBottom: "var(--s3)" }}>
          <div className="card-body">
            <strong>{t("int.mismatched", { n: mismatched })}</strong>
            <div className="page-sub" style={{ marginTop: "0.3rem" }}>
              {t("int.mismatchBody")}
            </div>
          </div>
        </div>
      )}

      <section>
        <div className="card">
          <div className="card-head">
            <h2>{t("int.byItem")}</h2>
            <span className="page-sub">
              {t("int.range", { from: shortDate(from), to: shortDate(shown) })} · {t("int.tiesTo")}
            </span>
          </div>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th colSpan={showThumbs ? 2 : 1}>{t("item")}</th>
                  <th className="r">{t("int.sold")}</th>
                  <th className="r">{t("int.revenue")}</th>
                  <th className="r">{t("int.shipped")}</th>
                  <th className="r">{t("int.cost")}</th>
                  <th className="r">{t("int.margin")}</th>
                  <th className="r">%</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const rev = Number(r.revenue);
                  const m = Number(r.margin);
                  const gap = Math.abs(Number(r.qty_sold) - Number(r.qty_shipped)) > 0.0001;
                  return (
                    <tr key={r.id}>
                      {showThumbs && (
                        <td className="vgroup-thumb">
                          <ItemThumb src={srcOf(r.id)} name={r.name} />
                        </td>
                      )}
                      <td className="wrap">
                        <ItemLink id={r.id} code={r.code} title={t("int.moveTitle")} />
                        <div className="subline">
                          {r.name}
                          <VariantTags variant={asVariant(r.variant)} className="vartags-inline" />
                        </div>
                      </td>
                      <td className="r">{fmtQty(String(r.qty_sold))}</td>
                      <td className="r">{money(rev)}</td>
                      <td className="r" style={{ color: gap ? "var(--warn)" : undefined }}>
                        {fmtQty(String(r.qty_shipped))}
                        {gap && <div className="subline">{t("int.notSame")}</div>}
                      </td>
                      <td className="r">{money(Number(r.cogs))}</td>
                      <td className="r" style={{ color: m < 0 ? "var(--bad)" : undefined }}>
                        <strong>{money(m)}</strong>
                      </td>
                      <td className="r" style={{ color: m < 0 ? "var(--bad)" : undefined }}>
                        {rev > 0 ? pct(m / rev) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={showThumbs ? 3 : 2}><strong>{t("int.total")}</strong></td>
                  <td className="r"><strong>{money(revenue)}</strong></td>
                  <td />
                  <td className="r"><strong>{money(cogs)}</strong></td>
                  <td className="r"><strong>{money(margin)}</strong></td>
                  <td className="r">
                    <strong>{revenue > 0 ? pct(margin / revenue) : "—"}</strong>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </section>
    </>
  );
}

async function Aging({
  companyId, locationId,
}: { companyId: string; locationId: string | null }) {
  const t = await getTranslations("inventory");
  const [rows, variantStock] = await Promise.all([
    getInventoryAging(companyId, locationId) as unknown as Promise<any[]>,
    getVariantStock(companyId) as unknown as Promise<any[]>,
  ]);

  const photos = variantPhotos(variantStock as never);
  const srcOf = (id: string) => {
    const v = variantStock.find((x) => x.id === id);
    return v ? photos.srcFor(v as never) : null;
  };
  const showThumbs = anyPhoto(rows.map((r: any) => r.id), srcOf);

  if (rows.length === 0) {
    return <div className="empty">{t("int.nothingAging")}</div>;
  }

  const total = rows.reduce((acc, r) => acc + Number(r.value), 0);
  const n = (r: any, k: string) => Number(r[k] ?? 0);
  const bucket = (k: string) => rows.reduce((acc, r) => acc + n(r, k), 0);
  /** Over ninety days is the conventional line for "this is not moving". */
  const slow = bucket("v90") + bucket("v180");
  const weightedAge = total > 0
    ? Math.round(rows.reduce((acc, r) => acc + Number(r.avg_age ?? 0) * Number(r.value), 0) / total)
    : 0;

  const BUCKETS = [
    { key: "v0", label: t("int.b0") }, { key: "v30", label: t("int.b30") },
    { key: "v60", label: t("int.b60") }, { key: "v90", label: t("int.b90") },
    { key: "v180", label: t("int.b180") },
  ] as const;

  return (
    <>
      <div className="kpis kpis-tiled">
        <div className="kpi">
          <span className="kpi-body">
            <span className="kpi-label">{t("int.ageStockValue")}</span>
            <span className="kpi-value">{money(total)}</span>
            <span className="kpi-note">{t("int.tiesStock")}</span>
          </span>
        </div>
        <div className="kpi">
          <span className="kpi-body">
            <span className="kpi-label">{t("int.sitting90")}</span>
            <span className="kpi-value" style={{ color: slow > 0 ? "var(--warn)" : undefined }}>
              {money(slow)}
            </span>
            <span className="kpi-note">
              {total > 0 ? t("int.pctShelf", { pct: pct(slow / total) }) : "—"}
            </span>
          </span>
        </div>
        <div className="kpi">
          <span className="kpi-body">
            <span className="kpi-label">{t("int.avgAge")}</span>
            <span className="kpi-value">{t("int.nDay", { n: weightedAge })}</span>
            <span className="kpi-note">{t("int.weighted")}</span>
          </span>
        </div>
      </div>

      <section>
        <div className="card">
          <div className="card-head">
            <h2>{t("int.asItStands")}</h2>
            <span className="page-sub">
              {t("int.agingSub")}
            </span>
          </div>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th colSpan={showThumbs ? 2 : 1}>{t("item")}</th>
                  <th className="r">{t("int.onHand")}</th>
                  <th className="r">{t("int.value")}</th>
                  <th className="r">{t("int.colAvgAge")}</th>
                  <th className="r">{t("int.oldest")}</th>
                  {BUCKETS.map((b) => <th key={b.key} className="r">{b.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    {showThumbs && (
                      <td className="vgroup-thumb">
                        <ItemThumb src={srcOf(r.id)} name={r.name} />
                      </td>
                    )}
                    <td className="wrap">
                      <ItemLink id={r.id} code={r.code} title={t("int.moveTitle")} />
                      <div className="subline">
                        {r.name}
                        <VariantTags variant={asVariant(r.variant)} className="vartags-inline" />
                      </div>
                    </td>
                    <td className="r">{fmtQty(String(r.qty))} {r.uom_code}</td>
                    <td className="r">{money(Number(r.value))}</td>
                    <td className="r">{t("int.nDay", { n: r.avg_age })}</td>
                    <td className="r">
                      {t("int.nDay", { n: r.oldest_days })}
                      <div className="subline">{shortDate(r.oldest)}</div>
                    </td>
                    {BUCKETS.map((b) => (
                      <td key={b.key} className="r"
                          style={{ color: n(r, b.key) === 0 ? "var(--line)"
                                        : b.key === "v180" ? "var(--bad)"
                                        : b.key === "v90" ? "var(--warn)" : undefined }}>
                        {n(r, b.key) === 0 ? "—" : money(n(r, b.key))}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={showThumbs ? 3 : 2}><strong>{t("int.total")}</strong></td>
                  <td className="r"><strong>{money(total)}</strong></td>
                  <td colSpan={2} />
                  {BUCKETS.map((b) => (
                    <td key={b.key} className="r"><strong>
                      {bucket(b.key) === 0 ? "—" : money(bucket(b.key))}
                    </strong></td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </section>
    </>
  );
}

/**
 * Profit matched to the units that earned it.
 *
 * The default reading, because it is the one that answers "is this product
 * worth selling". Revenue vs COGS next door answers "do the books agree",
 * which is a different and also necessary question.
 */
async function Matched({
  companyId, from, to, shown, locationId,
}: { companyId: string; from: string; to: string; shown: string;
     locationId: string | null }) {
  const t = await getTranslations("inventory");
  const [rows, variantStock] = await Promise.all([
    getMatchedProfitability(companyId, from, to, locationId) as unknown as Promise<any[]>,
    getVariantStock(companyId) as unknown as Promise<any[]>,
  ]);

  const photos = variantPhotos(variantStock as never);
  const srcOf = (id: string) => {
    const v = variantStock.find((x) => x.id === id);
    return v ? photos.srcFor(v as never) : null;
  };
  const showThumbs = anyPhoto(rows.map((r: any) => r.id), srcOf);

  if (rows.length === 0) {
    return <div className="empty">{t("int.nothingInvoiced")}</div>;
  }

  const n = (r: any, k: string) => Number(r[k] ?? 0);
  const revenue = rows.reduce((acc, r) => acc + n(r, "revenue"), 0);
  const matchedRev = rows.reduce((acc, r) => acc + n(r, "revenue_matched"), 0);
  const cost = rows.reduce((acc, r) => acc + n(r, "cost"), 0);
  const margin = matchedRev - cost;
  const unmatchedRev = revenue - matchedRev;
  const byItem = rows.reduce((acc, r) => acc + n(r, "n_by_item"), 0);
  const partShipped = rows.reduce((acc, r) => acc + n(r, "n_part_shipped"), 0);
  const returned = rows.reduce((acc, r) => acc + n(r, "n_returned"), 0);

  return (
    <>
      <div className="kpis kpis-tiled">
        <div className="kpi">
          <span className="kpi-body">
            <span className="kpi-label">{t("int.matchedRevenue")}</span>
            <span className="kpi-value">{money(matchedRev)}</span>
            <span className="kpi-note">
              {unmatchedRev > 0
                ? t("int.moreInvoiced", { amount: money(unmatchedRev) })
                : t("int.everyFound")}
            </span>
          </span>
        </div>
        <div className="kpi">
          <span className="kpi-body">
            <span className="kpi-label">{t("int.costOfUnits")}</span>
            <span className="kpi-value">{money(cost)}</span>
            <span className="kpi-note">{t("int.fifoDrew")}</span>
          </span>
        </div>
        <div className="kpi">
          <span className="kpi-body">
            <span className="kpi-label">{t("int.grossMargin")}</span>
            <span className="kpi-value" style={{ color: margin < 0 ? "var(--bad)" : undefined }}>
              {money(margin)}
            </span>
            <span className="kpi-note">
              {matchedRev > 0 ? t("int.pctMatched", { pct: pct(margin / matchedRev) }) : t("int.nothingMatched")}
            </span>
          </span>
        </div>
      </div>

      {/* How firm the figures are, said before they are read rather than
          after somebody has acted on them. */}
      {(unmatchedRev > 0 || byItem > 0 || partShipped > 0 || returned > 0) && (
        <div className="card" style={{ marginBottom: "var(--s3)" }}>
          <div className="card-body">
            <strong>{t("int.howMatched")}</strong>
            <ul className="matchnotes">
              {byItem > 0 && (
                <li>
                  <span className="pill">{t("int.pillByItem")}</span>
                  {t("int.byItemNote", { n: byItem })}
                </li>
              )}
              {partShipped > 0 && (
                <li>
                  <span className="pill warn">{t("int.pillPart")}</span>
                  {t("int.partNote", { n: partShipped })}
                </li>
              )}
              {returned > 0 && (
                <li>
                  <span className="pill">{t("int.pillReturns")}</span>
                  {t("int.returnsNote", { n: returned })}
                </li>
              )}
              {unmatchedRev > 0 && (
                <li>
                  <span className="pill overdue">{t("int.pillUnmatched")}</span>
                  {t("int.unmatchedNote", { amount: money(unmatchedRev) })}
                </li>
              )}
            </ul>
          </div>
        </div>
      )}

      <section>
        <div className="card">
          <div className="card-head">
            <h2>{t("int.byItem")}</h2>
            <span className="page-sub">
              {t("int.range", { from: shortDate(from), to: shortDate(shown) })} · {t("int.costMatchedSub")}
            </span>
          </div>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th colSpan={showThumbs ? 2 : 1}>{t("item")}</th>
                  <th className="r">{t("int.sold")}</th>
                  <th className="r">
                    {t("int.revenue")}
                    <div className="subline">{t("int.invoiced")}</div>
                  </th>
                  <th className="r">{t("int.cost")}</th>
                  <th className="r">{t("int.margin")}</th>
                  <th className="r">%</th>
                  <th>{t("int.matched")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const mr = n(r, "revenue_matched");
                  const m = r.margin === null ? null : Number(r.margin);
                  return (
                    <tr key={r.id}>
                      {showThumbs && (
                        <td className="vgroup-thumb">
                          <ItemThumb src={srcOf(r.id)} name={r.name} />
                        </td>
                      )}
                      <td className="wrap">
                        <ItemLink id={r.id} code={r.code} title={t("int.moveTitle")} />
                        <div className="subline">
                          {r.name}
                          <VariantTags variant={asVariant(r.variant)} className="vartags-inline" />
                        </div>
                      </td>
                      <td className="r">{fmtQty(String(r.qty))}</td>
                      <td className="r">{money(n(r, "revenue"))}</td>
                      <td className="r">
                        {r.cost === null ? <span className="page-sub">—</span> : money(Number(r.cost))}
                      </td>
                      <td className="r" style={{ color: m !== null && m < 0 ? "var(--bad)" : undefined }}>
                        {m === null ? <span className="page-sub">—</span> : <strong>{money(m)}</strong>}
                      </td>
                      <td className="r" style={{ color: m !== null && m < 0 ? "var(--bad)" : undefined }}>
                        {m !== null && mr > 0 ? pct(m / mr) : "—"}
                      </td>
                      <td>
                        <span className="vartags">
                          {n(r, "n_exact") > 0 && (
                            <span className="vartag">{t("int.tagExact", { n: n(r, "n_exact") })}</span>
                          )}
                          {n(r, "n_by_item") > 0 && (
                            <span className="vartag">{t("int.tagByItem", { n: n(r, "n_by_item") })}</span>
                          )}
                          {n(r, "n_unmatched") > 0 && (
                            <span className="vartag" style={{ color: "var(--bad)" }}>
                              {t("int.tagUnmatched", { n: n(r, "n_unmatched") })}
                            </span>
                          )}
                          {n(r, "n_part_shipped") > 0 && (
                            <span className="vartag" style={{ color: "var(--warn)" }}>
                              {t("int.tagPart", { n: n(r, "n_part_shipped") })}
                            </span>
                          )}
                          {n(r, "n_returned") > 0 && (
                            <span className="vartag">
                              {t("int.tagReturns", { n: n(r, "n_returned") })}
                            </span>
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {/* Two totals, because they are two different numbers. The
                  column adds up every invoice; the margin below it is only
                  ever over the part that found its goods, and one row
                  carrying both made the table look as though it disagreed
                  with the card above it. */}
              {/* The spans follow the thumbnail column. They were written
                  for a table that always had one, so when it drops out
                  every total slides one column to the right of the figures
                  it is totalling. */}
              <tfoot>
                <tr>
                  <td colSpan={showThumbs ? 3 : 2}>
                    <strong>{t("int.totalInvoiced")}</strong>
                  </td>
                  <td className="r"><strong>{money(revenue)}</strong></td>
                  <td colSpan={4} />
                </tr>
                <tr>
                  <td colSpan={showThumbs ? 3 : 2}>
                    <strong>{t("int.matchedRevenueRow")}</strong>
                    {unmatchedRev > 0 && (
                      <div className="subline">
                        {t("int.notYetCosted", { amount: money(unmatchedRev) })}
                      </div>
                    )}
                  </td>
                  <td className="r"><strong>{money(matchedRev)}</strong></td>
                  <td className="r"><strong>{money(cost)}</strong></td>
                  <td className="r"><strong>{money(margin)}</strong></td>
                  <td className="r">
                    <strong>{matchedRev > 0 ? pct(margin / matchedRev) : "—"}</strong>
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </section>
    </>
  );
}
