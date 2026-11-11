import Link from "next/link";
import { ArrowRight, Info, X } from "lucide-react";
import { sql } from "@/lib/db";
import { requirePermission, can } from "@/lib/auth";
import { money, shortDate } from "@/lib/format";
import { AutoApply } from "@/components/auto-apply";
import { SupplyCanvas } from "@/components/supply-canvas";
import { CategoryAdd } from "@/components/category-add";
import { getFlows, buildCanvas, categoryStats, CAT_COLORS } from "@/lib/supply-chain";

export const metadata = { title: "Supply chain" };

type Search = Record<string, string | undefined>;
const jan1 = () => `${new Date().getFullYear()}-01-01`;

/**
 * Goods through the business by product category, as a flow: suppliers on
 * the left (goods receipts), the chosen categories in the middle, customers
 * on the right (sales invoices). One category to start — the busiest in the
 * period — and more added as needed, so the canvas stays readable.
 */
export default async function SupplyChain({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requirePermission("reports.view");
  const sp = await searchParams;
  const co = user.companyId;
  // What goods came in at is cost: kyat on the supplier side only for those who may see cost.
  const seeCost = can(user, "cost.view");
  const measure: "qty" | "value" = sp.measure === "value" && seeCost ? "value" : "qty";
  const unit = measure === "qty" ? "units" : "MMK";
  const range = { from: sp.from || jan1(), to: sp.to || new Date().toISOString().slice(0, 10) };

  const [flows, groups, branches] = await Promise.all([
    getFlows(co, { ...range, branchId: sp.branch || null }),
    sql`select id, name from item_group where company_id = ${co} and is_active order by name`,
    sql`select id, name from location where company_id = ${co} and parent_id is null and is_active order by code`,
  ]);
  const cats = (groups as unknown as { id: string; name: string }[]).map((g) => ({
    ...g, units: flows.filter((f) => f.cat === g.id).reduce((t, f) => t + f.qty, 0),
    both: flows.some((f) => f.cat === g.id && f.side === "in") && flows.some((f) => f.cat === g.id && f.side === "out"),
  }));
  // The default is a category with goods both in and out — the whole chain —
  // and of those the busiest; a category only bought or only sold is half a picture.
  const busiest = [...cats].sort((a, b) => Number(b.both) - Number(a.both) || b.units - a.units)[0];
  const chosenIds = (sp.cats ? sp.cats.split(",") : busiest && busiest.units > 0 ? [busiest.id] : [])
    .filter((id, i, all) => cats.some((c) => c.id === id) && all.indexOf(id) === i).slice(0, CAT_COLORS.length);
  const chosen = chosenIds.map((id) => cats.find((c) => c.id === id)!);
  const canvas = buildCanvas(flows, chosen, measure);
  const focusId = chosenIds.includes(sp.focus ?? "") ? sp.focus! : chosenIds[0] ?? null;
  const focusCat = canvas.cats.find((c) => c.id === focusId) ?? null;
  const stats = focusId ? categoryStats(flows, focusId) : null;

  const keep = (over: Search) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...over })) if (v) q.set(k, v);
    return `?${q}`;
  };
  const without = (id: string) => {
    const rest = chosenIds.filter((x) => x !== id);
    return keep({ cats: rest.length ? rest.join(",") : "none", focus: sp.focus === id ? undefined : sp.focus });
  };
  const n = (v: number) => (measure === "qty" ? Math.round(v).toLocaleString("en-US") : money(v));
  const net = (a: number, b: number) => `${a - b >= 0 ? "+" : "−"}${n(Math.abs(a - b))}`;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Supply chain</h1>
          <p className="page-sub">Goods in from suppliers and out to customers, by product category</p>
        </div>
      </div>

      <form className="card filters sc-filters" method="get">
        {sp.cats && <input type="hidden" name="cats" value={sp.cats} />}
        {sp.focus && <input type="hidden" name="focus" value={sp.focus} />}
        <div className="field"><label htmlFor="sc-from">From</label><input id="sc-from" name="from" type="date" defaultValue={range.from} /></div>
        <div className="field"><label htmlFor="sc-to">To</label><input id="sc-to" name="to" type="date" defaultValue={range.to} /></div>
        {branches.length > 1 && (
          <div className="field">
            <label htmlFor="sc-branch">Branch</label>
            <select id="sc-branch" name="branch" defaultValue={sp.branch ?? ""}>
              <option value="">All branches</option>
              {(branches as unknown as { id: string; name: string }[]).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        )}
        <div className="field">
          <span className="sc-label" id="sc-measure">Show</span>
          <div className="segmented" role="radiogroup" aria-labelledby="sc-measure">
            <Link scroll={false} role="radio" aria-checked={measure === "qty"} className={`seg${measure === "qty" ? " on" : ""}`} href={keep({ measure: undefined })}>Units</Link>
            {seeCost && <Link scroll={false} role="radio" aria-checked={measure === "value"} className={`seg${measure === "value" ? " on" : ""}`} href={keep({ measure: "value" })}>Value</Link>}
          </div>
        </div>
        <div className="actions"><AutoApply /><button type="submit" className="btn ghost" data-apply>Apply</button></div>
      </form>

      <div className="sc-cats" aria-label="Categories on the canvas">
        {canvas.cats.map((c) => (
          <span key={c.id} className="sc-chip" data-on={c.id === focusId || undefined}>
            <i style={{ background: c.color }} aria-hidden="true" />
            <Link scroll={false} href={keep({ focus: c.id })}>{c.name}</Link>
            <Link scroll={false} href={without(c.id)} className="sc-chip-x" aria-label={`Remove ${c.name}`}><X size={13} aria-hidden="true" /></Link>
          </span>
        ))}
        <CategoryAdd options={cats} current={chosenIds} baseQuery={keep({ cats: undefined, focus: sp.focus })} />
        <span className="sc-hint"><Info size={14} aria-hidden="true" /> Ribbon width is {measure === "qty" ? "units" : "value"}. Received from goods receipts, sold from sales invoices.</span>
      </div>

      <div className="sc-board">
        <section className="card sc-canvas">
          {chosen.length === 0 ? (
            <div className="empty">{cats.some((c) => c.units > 0) ? "Add a category to see where its goods came from and went." : "No goods were received or sold in this period."}</div>
          ) : canvas.links.length === 0 ? (
            <div className="empty">Nothing in {chosen.map((c) => c.name).join(", ")} was received or sold in this period.</div>
          ) : (
            <SupplyCanvas left={canvas.left} cats={canvas.cats} right={canvas.right} links={canvas.links} unit={unit}
              focus={focusId} baseQuery={keep({ focus: undefined })} />
          )}
        </section>

        {focusCat && stats && (
          <aside className="card sc-panel" aria-label={`${focusCat.name} details`}>
            <h2><i style={{ background: focusCat.color }} aria-hidden="true" />{focusCat.name}</h2>
            <p className="page-sub">Category · {shortDate(range.from)} – {shortDate(range.to)}</p>
            <dl className="sc-dl">
              <div><dt>Received</dt><dd>{stats.inQty.toLocaleString("en-US")} units</dd></div>
              <div><dt>Sold</dt><dd>{stats.outQty.toLocaleString("en-US")} units</dd></div>
              <div><dt>Net stock movement</dt><dd className="sc-strong">{stats.inQty - stats.outQty >= 0 ? "+" : "−"}{Math.abs(stats.inQty - stats.outQty).toLocaleString("en-US")} units</dd></div>
              {seeCost && <div><dt>Received at cost</dt><dd>{money(stats.inValue)}</dd></div>}
              <div><dt>Sold for</dt><dd>{money(stats.outValue)}</dd></div>
              <div><dt>Suppliers</dt><dd>{stats.suppliers}{stats.topSupplier && <small>most: {stats.topSupplier}</small>}</dd></div>
              <div><dt>Customers</dt><dd>{stats.customers}{stats.topCustomer && <small>most: {stats.topCustomer}</small>}</dd></div>
            </dl>
            <div className="sc-links">
              <Link href={`/inventory/movements?from=${range.from}&to=${range.to}`}>Stock movements <ArrowRight size={14} aria-hidden="true" /></Link>
              <Link href={`/reports/price-history?side=sale&category=${focusCat.id}&from=${range.from}&to=${range.to}`}>Price history <ArrowRight size={14} aria-hidden="true" /></Link>
            </div>
          </aside>
        )}
      </div>

      {canvas.cats.length > 0 && (
        <section className="card">
          <div className="card-head"><h2>Selected categories</h2><span className="page-sub">{measure === "qty" ? "Units" : "MMK"}</span></div>
          <div className="tablewrap">
            <table className="ph-table">
              <thead><tr><th>Category</th><th className="r">Received</th><th className="r">Sold</th><th className="r">Net movement</th><th className="r">Suppliers</th><th className="r">Customers</th></tr></thead>
              <tbody>
                {canvas.cats.map((c) => {
                  const s = categoryStats(flows, c.id);
                  return (
                    <tr key={c.id} data-active={c.id === focusId || undefined}>
                      <td><span className="sc-dot" style={{ background: c.color }} aria-hidden="true" /><Link scroll={false} href={keep({ focus: c.id })} className="ph-prod">{c.name}</Link></td>
                      <td className="r">{n(c.inTotal)}</td>
                      <td className="r">{n(c.outTotal)}</td>
                      <td className="r"><strong>{net(c.inTotal, c.outTotal)}</strong></td>
                      <td className="r">{s.suppliers}</td>
                      <td className="r">{s.customers}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="ph-foot"><span className="page-sub">Returns are not netted off. Net movement is received less sold in the period, not stock on hand.</span></div>
        </section>
      )}
    </>
  );
}
