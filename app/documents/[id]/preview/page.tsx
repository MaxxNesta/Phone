import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Printer, Check, Circle, CircleDot, Receipt, FileText, Truck, Undo2, CreditCard, PenLine } from "lucide-react";
import { requireUser, can, permissionForDocument } from "@/lib/auth";
import { seenLocations } from "@/lib/branch-scope";
import { hidesPay } from "@/lib/hr";
import { getDocument } from "@/lib/queries";
import { money, todayLocal } from "@/lib/format";
import { invoicePreview, flatten } from "@/lib/document-preview";
import { PreviewLines, type PreviewLine } from "@/components/doc-preview-lines";

const fmtDate = (v: unknown) => (v ? new Date(String(v).length === 10 ? `${v}T00:00:00Z` : String(v))
  .toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Yangon" }) : "—");
const fmtTime = (v: unknown) => (!v || /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? "" : new Date(String(v)).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Yangon" }));

/**
 * A preview of the invoice page in a cleaner layout (after Astryx's invoice
 * template), on real data: the lines, what was paid and how, the flow from
 * order to payment, related documents and a timeline. The classic page is
 * untouched; this sits beside it at /documents/[id]/preview.
 */
export default async function InvoicePreview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const doc = await getDocument(id);
  if (!doc || doc.company_id !== user.companyId || !can(user, permissionForDocument(doc.doc_type))) notFound();
  const seen = await seenLocations();
  if (seen && !seen.includes(doc.location_id)) notFound();
  if (await hidesPay(user, doc.id)) notFound();
  if (doc.doc_type !== "SALES_INVOICE" && doc.doc_type !== "PURCHASE_INVOICE") redirect(`/documents/${id}`);

  const sale = doc.doc_type === "SALES_INVOICE";
  const p = await invoicePreview(id);
  const total = Number(doc.gross_total ?? 0), net = Number(doc.net_total ?? 0), tax = Number(doc.tax_total ?? 0);
  const outstanding = doc.status === "POSTED" ? p.outstanding : 0;
  /* Settled three ways: payments allocated to it, returns and notes that
     credited it, and (a counter sale) the money taken with the sale itself. */
  const flatRel = flatten(p.related);
  const credited = flatRel.filter((r) => /RETURN|CREDIT_NOTE|DEBIT_NOTE/.test(r.docType) && r.status === "POSTED")
    .reduce((t, r) => t + Number(r.amount || 0), 0);
  const allocated = p.payments.reduce((t, x) => t + x.amount, 0);
  const atCounter = Math.max(0, total - outstanding - credited - allocated);
  const paid = allocated + atCounter;
  const linesSum = p.lines.reduce((t, l) => t + Number(l.net_amount ?? 0), 0);
  const discount = Math.max(0, linesSum - net);
  // A date column arrives as a Date at local midnight; compare its calendar day, not its text.
  const ymd = (v: unknown) => v instanceof Date
    ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`
    : String(v ?? "").slice(0, 10);
  const overdue = outstanding > 0.005 && !!doc.due_date && ymd(doc.due_date) < todayLocal();
  const status = doc.status === "REVERSED" || doc.status === "VOID" ? { label: "Voided", tone: "mute" }
    : outstanding <= 0.005 ? { label: "Paid", tone: "ok" }
    : overdue ? { label: "Overdue", tone: "bad" }
    : paid > 0 ? { label: "Part paid", tone: "warn" } : { label: "Unpaid", tone: "warn" };

  const lines: PreviewLine[] = p.lines.map((l) => ({
    id: String(l.id), code: String(l.item_code ?? ""), name: String(l.item_name ?? l.description ?? "Line"),
    brand: (l.brand_name as string) ?? null, qty: Number(l.entered_qty ?? 0), unit: String(l.uom_code ?? ""),
    price: Number(l.unit_price ?? 0), amount: Number(l.net_amount ?? 0), free: (l.foc_reason as string) ?? null,
    imei: p.serialLines.has(String(l.id)),
  }));

  const rel = flatRel;
  const has = (re: RegExp) => rel.filter((r) => re.test(r.docType));
  const orders = has(sale ? /SALES_ORDER/ : /PURCHASE_ORDER/);
  const moves = has(sale ? /DELIVERY/ : /GOODS_RECEIPT/);
  const returns = has(sale ? /SALES_RETURN|CREDIT_NOTE/ : /PURCHASE_RETURN|DEBIT_NOTE/);
  type Step = { label: string; detail: string; state: "done" | "now" | "todo" | "skip"; href?: string };
  const steps: Step[] = [
    { label: "Order", detail: orders[0] ? orders[0].docNo : "Sold without an order", state: orders[0] ? "done" : "skip", href: orders[0] ? `/documents/${orders[0].id}` : undefined },
    { label: sale ? "Goods out" : "Goods in", detail: moves[0] ? `${moves[0].docNo}${moves.length > 1 ? ` and ${moves.length - 1} more` : ""}` : sale && !doc.to_deliver ? "Handed over with the invoice" : "Waiting",
      state: moves[0] || (sale && !doc.to_deliver) ? "done" : "now", href: moves[0] ? `/documents/${moves[0].id}` : undefined },
    { label: "Invoice", detail: `${doc.doc_no} · ${fmtDate(doc.posting_date)}`, state: "done" },
    { label: sale ? "Paid by customer" : "Paid to supplier", detail: outstanding <= 0.005 ? "Settled in full" : paid > 0 ? `${money(paid)} paid, ${money(outstanding)} to go` : "Nothing yet",
      state: outstanding <= 0.005 ? "done" : "now" },
    ...(returns.length ? [{ label: "Returned", detail: `${returns.map((r) => r.docNo).join(", ")}`, state: "done" as const, href: `/documents/${returns[0].id}` }] : []),
  ];

  type Ev = { at: string; icon: "pen" | "post" | "pay" | "doc" | "move" | "back"; text: string; who?: string | null; href?: string };
  const events: Ev[] = [
    ...(p.people.doc?.created_at ? [{ at: String(p.people.doc.created_at), icon: "pen" as const, text: "Created", who: p.people.doc.created_by as string | null }] : []),
    ...(p.people.doc?.posted_at ? [{ at: String(p.people.doc.posted_at), icon: "post" as const, text: `Posted · ${money(total)} MMK`, who: p.people.doc.posted_by as string | null }] : []),
    ...p.payments.map((x) => ({ at: x.posted_at ?? x.date, icon: "pay" as const, text: `${money(x.amount)} received${x.channel ? ` by ${x.channel}` : ""} · ${x.doc_no}`, href: `/documents/${x.id}` })),
    ...rel.filter((r) => !p.payments.some((x) => x.id === r.id)).map((r) => ({
      at: r.docDate, icon: (/RETURN|NOTE/.test(r.docType) ? "back" : /DELIVERY|RECEIPT$|GOODS/.test(r.docType) ? "move" : "doc") as Ev["icon"],
      text: `${r.group} ${r.docNo}${r.amount ? ` · ${money(r.amount)}` : ""}`, href: `/documents/${r.id}` })),
    ...(p.people.activity as unknown as { kind: string; note: string; happened_at: string; actor: string | null }[])
      .map((a) => ({ at: String(a.happened_at), icon: "doc" as const, text: a.note, who: a.actor })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1));
  const ICON = { pen: PenLine, post: Receipt, pay: CreditCard, doc: FileText, move: Truck, back: Undo2 };

  const meta: [string, React.ReactNode][] = [
    [sale ? "Billed to" : "Supplier", doc.partner_id ? <Link href={`/partners/${doc.partner_id}`}>{doc.partner_name}</Link> : "Walk-in"],
    ["Invoice date", fmtDate(doc.posting_date)],
    ["Due date", doc.due_date ? fmtDate(doc.due_date) : "On the day"],
    ["Payment", doc.payment_type === "CASH" ? `Paid at the counter${doc.payment_channel_name ? `, ${doc.payment_channel_name}` : ""}` : "On credit"],
    ["Reference", doc.reference || doc.payment_reference || "—"],
    ["Created by", (p.people.doc?.created_by as string) ?? "—"],
  ];

  return (
    <div className="dp">
      <div className="dp-top">
        <Link href={`/documents/${id}`} className="dp-back"><ArrowLeft size={15} aria-hidden="true" /> Classic view</Link>
        <span className="dp-preview">Preview layout</span>
      </div>
      <header className="dp-head">
        <div>
          <h1>{sale ? "Invoice" : "Purchase invoice"} {doc.doc_no}</h1>
          <span className={`dp-badge ${status.tone}`}>{status.label}</span>
        </div>
        <div className="dp-actions">
          <Link href={`/documents/${id}/print`} className="dp-btn"><Printer size={15} aria-hidden="true" /> Print</Link>
          {outstanding > 0.005 && doc.status === "POSTED" && (
            <Link href={sale ? `/receivables/receive?partner=${doc.partner_id}` : `/payables/pay?partner=${doc.partner_id}`} className="dp-btn primary">
              {sale ? "Receive payment" : "Pay supplier"}
            </Link>
          )}
        </div>
      </header>

      <dl className="dp-meta">
        {meta.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>

      <div className="dp-body">
        <main className="dp-main">
          <PreviewLines lines={lines} />
          <dl className="dp-totals">
            <div><dt>Subtotal</dt><dd>{money(linesSum)}</dd></div>
            {discount > 0.005 && <div><dt>Discount</dt><dd>− {money(discount)}</dd></div>}
            {tax > 0 && <div><dt>Tax</dt><dd>{money(tax)}</dd></div>}
            <div className="dp-total"><dt>Total</dt><dd>{money(total)} <small>MMK</small></dd></div>
            {paid > 0 && <div><dt>Paid</dt><dd>− {money(paid)}</dd></div>}
            {credited > 0 && <div><dt>Returned or credited</dt><dd>− {money(credited)}</dd></div>}
            <div className={`dp-due${outstanding > 0.005 ? " open" : ""}`}><dt>Balance due</dt><dd>{money(outstanding)}</dd></div>
          </dl>
          {doc.memo && <p className="dp-memo">{doc.memo}</p>}
        </main>

        <aside className="dp-rail">
          <section className="dp-card">
            <h2>Payment</h2>
            <div className="dp-meter" role="img" aria-label={`${total ? Math.round((paid / total) * 100) : 0}% paid, ${total ? Math.round((credited / total) * 100) : 0}% returned`}>
              <i style={{ width: `${total ? Math.min(100, (paid / total) * 100) : 0}%` }} />
              {credited > 0 && <i className="ret" style={{ width: `${total ? Math.min(100, (credited / total) * 100) : 0}%` }} />}
            </div>
            <p className="dp-meter-read"><strong>{money(paid)}</strong> paid{credited > 0 && <>, <strong>{money(credited)}</strong> returned</>} of {money(total)}
              {outstanding > 0.005 && <> · <span className={overdue ? "bad" : ""}>{money(outstanding)} due</span></>}</p>
            {p.payments.length > 0 ? (
              <ul className="dp-pays">
                {p.payments.map((x) => (
                  <li key={x.id}><Link href={`/documents/${x.id}`}>{x.doc_no}</Link><span>{fmtDate(x.date)}{x.channel ? ` · ${x.channel}` : ""}</span><b>{money(x.amount)}</b></li>
                ))}
              </ul>
            ) : doc.payment_type === "CASH" && paid > 0 ? <p className="dp-quiet">Paid at the counter with the sale.</p>
              : <p className="dp-quiet">No payment recorded yet.</p>}
          </section>

          <section className="dp-card">
            <h2>Flow</h2>
            <ol className="dp-flow">
              {steps.map((s) => {
                const I = s.state === "done" ? Check : s.state === "now" ? CircleDot : Circle;
                return (
                  <li key={s.label} className={s.state}>
                    <I size={16} aria-hidden="true" />
                    <span><strong>{s.label}</strong>{s.href ? <Link href={s.href}>{s.detail}</Link> : <em>{s.detail}</em>}</span>
                  </li>
                );
              })}
            </ol>
          </section>

          <section className="dp-card">
            <h2>Related documents</h2>
            {rel.length === 0 ? <p className="dp-quiet">Nothing was raised from this invoice or before it.</p> : (
              <ul className="dp-rel">
                {rel.map((r) => (
                  <li key={r.id}><span className="dp-rel-type">{r.group}</span><Link href={`/documents/${r.id}`}>{r.docNo}</Link>
                    <span className="dp-sub">{fmtDate(r.docDate)}</span><b>{r.amount ? money(r.amount) : r.qty ? `${r.qty} units` : ""}</b></li>
                ))}
              </ul>
            )}
          </section>

          <section className="dp-card">
            <h2>Activity</h2>
            <ol className="dp-time">
              {events.map((e, i) => {
                const I = ICON[e.icon];
                return (
                  <li key={i}><I size={14} aria-hidden="true" />
                    <span>{e.href ? <Link href={e.href}>{e.text}</Link> : e.text}
                      <em>{fmtTime(e.at) || fmtDate(e.at)}{e.who ? ` · ${e.who}` : ""}</em></span>
                  </li>
                );
              })}
            </ol>
          </section>
        </aside>
      </div>
    </div>
  );
}
