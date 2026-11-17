import Link from "next/link";
import { money, shortDate } from "@/lib/format";
import { DataTable, type DataRow } from "@/components/data-table";
import { PeriodPicker } from "@/components/period-picker";
import type { Period } from "@/lib/period";
import type { discountReport, Side } from "@/lib/discount-report";

type Report = Awaited<ReturnType<typeof discountReport>>;

const dash = (v: number) => (v ? money(v) : "—");
const CATEGORY: Record<string, { label: string; tone: string; help: string }> = {
  WITH_SALE: { label: "With a sale", tone: "ok", help: "Given with something sold: its cost is cost of sales, and it earns a share of the sale's revenue." },
  STANDALONE: { label: "Standalone giveaway", tone: "warn", help: "Left with no sale behind it: its cost goes to the reason's own account." },
  FROM_SUPPLIER: { label: "From supplier", tone: "posted", help: "Sent free on a bill: it carries its share of what the paid units cost." },
};

/**
 * Discounts and free goods for one side. Every figure names where it came
 * from: a discount by kind and document, a free unit by why it was free and
 * where its cost went, so nothing on the page is a total without its lines.
 */
export function DiscountReportView({ side, r, period, hrefFor, seeCost }: {
  side: Side; r: Report; period: Period; hrefFor: (k: string) => string;
  /** Without cost.view, what goods cost is not shown (a cashier sees quantities only). */
  seeCost: boolean;
}) {
  const cost = (v: number) => (seeCost ? money(v) : "—");
  const sales = side === "sales";
  const who = sales ? "Customer" : "Supplier";
  const t = r.totals;
  const gl = r.ledger[0];

  const discountRows: DataRow[] = [
    ...r.lines.map((l) => ({
      key: l.id,
      searchText: [l.doc_no, l.partner, l.item_code, l.item_name].join(" "),
      sort: { date: l.date, doc: l.doc_no, partner: l.partner, total: l.line_d + l.volume_d + l.invoice_d },
      node: (
        <tr>
          <td className="code">{shortDate(l.date)}</td>
          <td className="code"><Link href={`/documents/${l.document_id}`} style={{ color: "var(--link)" }}>{l.doc_no}</Link></td>
          <td className="wrap">{l.partner}</td>
          <td className="wrap">{l.item_name}<div className="subline">{l.item_code}</div></td>
          <td className="r">{dash(l.line_d)}</td>
          {sales && <td className="r">{dash(l.volume_d)}</td>}
          <td className="r">{dash(l.invoice_d)}</td>
          <td className="r">—</td>
          <td className="r"><strong>{money(l.line_d + l.volume_d + l.invoice_d)}</strong></td>
          <td className="wrap subline">{sales ? "4190 Sales Discounts (on posting)"
            : l.credited ? "Credited to Purchase Discounts (gross method)" : "Lowered the goods' cost (net method)"}</td>
        </tr>
      ),
    })),
    ...r.notes.map((n) => ({
      key: n.document_id,
      searchText: [n.doc_no, n.partner, n.against, n.reason].join(" "),
      sort: { date: n.date, doc: n.doc_no, partner: n.partner, total: n.amount },
      node: (
        <tr>
          <td className="code">{shortDate(n.date)}</td>
          <td className="code"><Link href={`/documents/${n.document_id}`} style={{ color: "var(--link)" }}>{n.doc_no}</Link></td>
          <td className="wrap">{n.partner}</td>
          <td className="wrap">{n.reason}
            {n.against && <div className="subline">on <Link href={`/documents/${n.against_id}`} style={{ color: "var(--link)" }}>{n.against}</Link></div>}</td>
          <td className="r">—</td>
          {sales && <td className="r">—</td>}
          <td className="r">—</td>
          <td className="r">{money(n.amount)}</td>
          <td className="r"><strong>{money(n.amount)}</strong></td>
          <td className="wrap subline">{n.landed.map((x) => `${x.code} ${x.name} ${money(x.amount)}`).join(" · ")}</td>
        </tr>
      ),
    })),
  ];

  const freeRows: DataRow[] = r.free.map((f) => {
    const c = CATEGORY[f.category];
    return {
      key: f.id,
      searchText: [f.doc_no, f.partner, f.item_code, f.item_name, f.reason, c.label].join(" "),
      sort: { date: f.date, doc: f.doc_no, partner: f.partner, category: c.label, qty: f.qty, cost: f.cost },
      node: (
        <tr>
          <td className="code">{shortDate(f.date)}</td>
          <td className="code"><Link href={`/documents/${f.document_id}`} style={{ color: "var(--link)" }}>{f.doc_no}</Link></td>
          <td className="wrap">{f.partner}</td>
          <td className="wrap">{f.item_name}<div className="subline">{f.item_code}</div></td>
          <td><span className={`pill ${c.tone}`} title={c.help}>{c.label}</span></td>
          <td className="wrap">{f.reason}</td>
          <td className="r">{f.qty.toLocaleString("en-US")}</td>
          <td className="r">{cost(f.cost)}</td>
          {sales && <td className="wrap subline">{seeCost ? f.charged_to ?? "—" : "—"}</td>}
          {sales && <td className="r">{f.revenue ? money(f.revenue) : "—"}</td>}
        </tr>
      ),
    };
  });

  return (
    <>
      <section>
        <div className="card">
          <div className="card-head">
            <h2>{period.label}</h2>
            <PeriodPicker current={period} label="discounts" hrefFor={hrefFor} />
          </div>
          <div className="card-body">
            <div className="row">
              <div className="field">
                <label>{sales ? "On invoices" : "On bills"}</label>
                <span className="fixedfield">{money(t.onLines)}</span>
                <span className="hint">line{sales ? ", volume" : ""} and {sales ? "invoice" : "bill"}-wide</span>
              </div>
              <div className="field">
                <label>{sales ? "After the sale" : "After billing"}</label>
                <span className="fixedfield">{money(t.afterwards)}</span>
                <span className="hint">{r.notes.length} {sales ? "credit" : "debit"} note{r.notes.length === 1 ? "" : "s"} marked Discount</span>
              </div>
              <div className="field">
                <label>Total discount</label>
                <span className="fixedfield">{money(t.total)}</span>
                <span className="hint">{t.grossOfDiscounted > 0 ? `${((t.onLines / t.grossOfDiscounted) * 100).toFixed(1)}% off the discounted lines` : "—"}</span>
              </div>
              <div className="field">
                <label>In the ledger</label>
                <span className="fixedfield">{gl ? money(sales ? gl.v : -gl.v) : "—"}</span>
                <span className="hint">{gl ? `${gl.code} ${gl.name}` : "no account set"}{sales
                  ? " · deliver-later discounts post when the goods go"
                  : " · net-method discounts are in the goods' cost, not here"}</span>
              </div>
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <div className="field">
                <label>{sales ? "Free units given" : "Free units received"}</label>
                <span className="fixedfield">{t.freeQty.toLocaleString("en-US")}</span>
                <span className="hint">{r.free.length} line{r.free.length === 1 ? "" : "s"}</span>
              </div>
              {sales ? (<>
                <div className="field">
                  <label>Free with a sale — cost</label>
                  <span className="fixedfield">{cost(t.freeWithSale)}</span>
                  <span className="hint">in cost of sales</span>
                </div>
                <div className="field">
                  <label>Standalone giveaways — cost</label>
                  <span className="fixedfield">{cost(t.freeStandalone)}</span>
                  <span className="hint">in each reason&rsquo;s account</span>
                </div>
                <div className="field">
                  <label>Revenue allocated to free items</label>
                  <span className="fixedfield">{money(t.freeRevenue)}</span>
                  <span className="hint">IFRS 15 share; the invoice still shows them at 0</span>
                </div>
              </>) : (
                <div className="field">
                  <label>Cost carried by free units</label>
                  <span className="fixedfield">{cost(t.freeCost)}</span>
                  <span className="hint">their share of the bill; total stock cost unchanged</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {r.byPartner.length > 0 && (
        <section>
          <div className="card">
            <div className="card-head"><h2>By {who.toLowerCase()}</h2><span className="page-sub">largest first</span></div>
            <div className="tablewrap">
              <table>
                <thead><tr><th>{who}</th><th className="r">{sales ? "Invoices" : "Bills"}</th>
                  <th className="r">On {sales ? "invoices" : "bills"}</th><th className="r">Afterwards</th>
                  <th className="r">Total</th><th className="r">Rate</th></tr></thead>
                <tbody>
                  {r.byPartner.map((p) => (
                    <tr key={p.partner}>
                      <td className="wrap">{p.partner}</td>
                      <td className="r">{p.docs}</td>
                      <td className="r">{dash(p.onLines)}</td>
                      <td className="r">{dash(p.afterwards)}</td>
                      <td className="r"><strong>{money(p.total)}</strong></td>
                      <td className="r">{p.gross > 0 ? `${((p.onLines / p.gross) * 100).toFixed(1)}%` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      <section>
        <div className="card">
          <div className="card-head"><h2>Every discount</h2><span className="page-sub">{discountRows.length} rows</span></div>
          <DataTable
            rows={discountRows}
            emptyLabel="No discounts in this period"
            searchPlaceholder={`Search documents, ${who.toLowerCase()}s, items…`}
            defaultSort={{ key: "date", dir: "desc" }}
            columns={[
              { key: "date", label: "Date", sortable: true },
              { key: "doc", label: "Document", sortable: true },
              { key: "partner", label: who, sortable: true },
              { key: "item", label: "Item / reason" },
              { key: "line", label: "Line", align: "r" },
              ...(sales ? [{ key: "volume", label: "Volume", align: "r" as const }] : []),
              { key: "inv", label: sales ? "Invoice-wide" : "Bill-wide", align: "r" },
              { key: "after", label: sales ? "After the sale" : "After billing", align: "r" },
              { key: "total", label: "Total", sortable: true, align: "r" },
              { key: "where", label: "Where it went" },
            ]}
          />
        </div>
      </section>

      <section>
        <div className="card">
          <div className="card-head"><h2>Free of charge</h2><span className="page-sub">{freeRows.length} lines</span></div>
          <DataTable
            rows={freeRows}
            emptyLabel="No free goods in this period"
            searchPlaceholder="Search documents, items, reasons…"
            defaultSort={{ key: "date", dir: "desc" }}
            columns={[
              { key: "date", label: "Date", sortable: true },
              { key: "doc", label: "Document", sortable: true },
              { key: "partner", label: who, sortable: true },
              { key: "item", label: "Item" },
              { key: "category", label: "Category", sortable: true },
              { key: "reason", label: "Reason" },
              { key: "qty", label: "Qty", sortable: true, align: "r" },
              { key: "cost", label: "Cost", sortable: true, align: "r" },
              ...(sales ? [{ key: "charged", label: "Cost went to" }, { key: "revenue", label: "Revenue share", align: "r" as const }] : []),
            ]}
          />
        </div>
      </section>
    </>
  );
}
