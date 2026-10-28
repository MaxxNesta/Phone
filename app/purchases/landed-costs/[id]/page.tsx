import Link from "next/link";
import { notFound } from "next/navigation";
import { sql, money } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/auth-core";
import { seenLocations } from "@/lib/branch-scope";
import {
  getLandedCost, postedReceipts, landedCostTypes, landedCostTemplates, clearingSources, LC_STATUS,
} from "@/lib/landed-cost-queries";
import { getDocumentAttachments } from "@/lib/queries";
import { uploadAttachment, deleteAttachment } from "@/lib/actions";
import { storageConfigured } from "@/lib/r2";
import { DocumentAttachments } from "@/components/document-attachments";
import { LandedCostEditor, LandedCostStep, type EditorCharge } from "@/components/landed-cost-editor";
import { ErpCrumbs } from "@/components/erp-worklist";

const METHOD: Record<string, string> = { VALUE: "By purchase value", EQUAL: "Equal per phone", MANUAL: "Manual by product variant" };
const STATUS_NOW: Record<string, string> = {
  IN_STOCK: "In stock", SOLD: "Sold", RETURNED_TO_SUPPLIER: "Returned to supplier", WRITTEN_OFF: "Written off",
  ISSUED: "Issued", RESERVED: "Reserved", REPAIR: "In repair",
};
// Where each phone's share went when this posted. Delivered but not invoiced
// waits in Goods Shipped Not Invoiced: cost of sales is recognised when the invoice posts.
const TREATMENT: Record<string, string> = {
  INVENTORY: "to stock value", HOLDING: "to goods shipped not invoiced, waiting for the invoice", COGS: "to cost of sales",
};
const when = (t: string | Date | null) => (t ? new Date(t).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "");

export default async function LandedCostPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("cost.view");
  const { id } = await params;
  const lc = await getLandedCost(user.companyId, id);
  if (!lc) notFound();
  const locs = await seenLocations();
  // Someone limited to a branch sees a landed cost only over their own receipts.
  if (locs && lc.receipts.some((r: any) => r.location_id && !locs.includes(r.location_id))) notFound();

  const { head } = lc;
  const draft = head.doc_status === "DRAFT";
  const mayPost = can(user, "purchase.post");
  const [co] = await sql`select base_currency from company where id = ${user.companyId}`;
  const base = co.base_currency as string;

  const [receipts, types, templates, sources, partners, accounts, currencies, [clearing], attachments] = await Promise.all([
    draft ? postedReceipts(user.companyId, locs) : Promise.resolve([]),
    landedCostTypes(user.companyId, true),
    landedCostTemplates(user.companyId, true),
    draft ? clearingSources(user.companyId, id) : Promise.resolve([]),
    sql`select id, name from business_partner where company_id = ${user.companyId} and is_supplier and is_active order by name`,
    sql`select id, code || ' ' || name as label from account where company_id = ${user.companyId}
          and account_type = 'ASSET' and is_postable and coalesce(is_active, true) order by code`,
    sql`select c.code, (select r.rate::float from exchange_rate r where r.company_id = ${user.companyId}
                          and r.from_currency = c.code and r.to_currency = ${base} order by r.valid_from desc limit 1) as rate,
                       (select r.valid_from::text from exchange_rate r where r.company_id = ${user.companyId}
                          and r.from_currency = c.code and r.to_currency = ${base} order by r.valid_from desc limit 1) as rate_date
          from currency c order by c.code = ${base} desc, c.code`,
    sql`select fn_system_account(${user.companyId}, 'LANDED_COST_CLEARING') as a`,
    getDocumentAttachments(user.companyId, id),
  ]) as any[];

  // The phones grouped by product variant: what they cost, what this adds.
  const allocated = lc.phones.length > 0;
  const units: any[] = allocated ? lc.phones : lc.eligible;
  const variants = [...new Map(units.map((u: any) => [u.item_id, { itemId: u.item_id, name: u.item_name }])).values()]
    .map((v) => {
      const ps = units.filter((u: any) => u.item_id === v.itemId);
      return {
        ...v, phones: ps.length, rows: ps,
        original: ps.reduce((t: number, p: any) => t + Number(p.original_cost ?? 0), 0),
        added: ps.reduce((t: number, p: any) => t + Number(p.allocated ?? 0), 0),
      };
    });
  const totals = variants.reduce((t, v) => ({ original: t.original + v.original, added: t.added + v.added }), { original: 0, added: 0 });

  const charges: EditorCharge[] = lc.charges.length > 0
    ? lc.charges.map((c: any, i: number) => ({
        key: i + 1, costTypeId: c.cost_type_id, partnerId: c.partner_id ?? "",
        sourceJournalLineId: c.source_journal_line_id ?? "", description: c.description ?? "",
        currency: c.currency, exchangeRate: String(c.exchange_rate), rateDate: c.rate_date ?? head.doc_date,
        amount: String(c.fc_amount), method: c.method, clearingAccountId: c.clearing_account_id, reference: c.reference ?? "",
        manual: Object.fromEntries((c.manual as any[]).map((m) => [m.itemId, String(m.amount)])),
      }))
    : (templates.find((t: any) => t.id === head.template_id)?.lines ?? []).map((l: any, i: number) => {
        const t = types.find((x: any) => x.id === l.costTypeId);
        return {
          key: i + 1, costTypeId: l.costTypeId, partnerId: t?.default_partner_id ?? "", sourceJournalLineId: "",
          description: "", currency: t?.default_currency ?? base, exchangeRate: "1", rateDate: head.doc_date,
          amount: "", method: l.method, clearingAccountId: t?.clearing_account_id ?? "", reference: "", manual: {},
        };
      });

  const needsAck = lc.excluded.length > 0 && !head.excluded_ack_at;
  const status = head.status as string;

  return (
    <>
      <ErpCrumbs steps={[{ label: "Landed costs", href: "/purchases/landed-costs" }, { label: head.doc_no }]} />
      <div className="page-head">
        <span className="eyebrow">Purchases · Landed cost</span>
        <h1 className="m">{head.doc_no}</h1>
        <span className={`lc-status lc-${status.toLowerCase()}`}>{LC_STATUS[status] ?? status}</span>
        <span className="page-sub">{money(head.total)} {base} in charges</span>
      </div>

      <dl className="lc-trail">
        <div><dt>Created</dt><dd>{head.created_by ?? "—"} · {when(head.created_at)}</dd></div>
        {head.calculated_at && <div><dt>Calculated</dt><dd>{head.calculated_by ?? "—"} · {when(head.calculated_at)}</dd></div>}
        {head.posted_at && <div><dt>Posted</dt><dd>{head.posted_by ?? "—"} · {when(head.posted_at)}
          {head.entry_no && <> · journal <span className="m">{head.entry_no}</span></>}</dd></div>}
        {head.reversed_at && <div><dt>Reversed</dt><dd>{head.reversed_by ?? "—"} · {when(head.reversed_at)} ·
          {" "}<Link href={`/purchases/landed-costs/${head.reversed_by_document_id}`} className="m">{head.reversal_no}</Link>
          {" "}— “{head.reversal_reason}”</dd></div>}
        {head.shipment_ref && !draft && <div><dt>Shipment</dt><dd>{head.shipment_ref}{head.carrier_ref ? ` · ${head.carrier_ref}` : ""}</dd></div>}
      </dl>

      {draft && mayPost ? (
        <LandedCostEditor
          id={id}
          base={base}
          header={{ docDate: head.doc_date, templateId: head.template_id ?? "", shipmentRef: head.shipment_ref ?? "",
                    carrierRef: head.carrier_ref ?? "", notes: head.notes ?? "" }}
          receipts={(receipts as any[]).map((r) => ({
            id: r.id, label: `${r.doc_no} · ${r.supplier ?? "—"}`,
            meta: `${r.doc_date} · ${r.warehouse ?? "—"} · ${r.phones} phone${r.phones === 1 ? "" : "s"}`,
            earlier: r.landed_costs > 0 ? `${r.landed_costs} landed cost${r.landed_costs === 1 ? "" : "s"}` : "",
          }))}
          chosen={lc.receipts.map((r: any) => r.id)}
          charges={charges}
          types={types.map((t: any) => ({ id: t.id, label: t.name, method: t.default_method, partnerId: t.default_partner_id,
                                          currency: t.default_currency, accountId: t.clearing_account_id }))}
          templates={templates.map((t: any) => ({ id: t.id, label: t.name, lines: t.lines }))}
          partners={partners.map((p: any) => ({ id: p.id, label: p.name }))}
          accounts={accounts.map((a: any) => ({ id: a.id, label: a.label }))}
          currencies={currencies.map((c: any) => ({ code: c.code, rate: c.code === base ? 1 : c.rate, rateDate: c.rate_date }))}
          sources={sources as never}
          variants={variants.map((v) => ({ itemId: v.itemId, name: v.name, phones: v.phones }))}
          clearingId={clearing.a}
        />
      ) : null}

      <section className="card">
        <div className="card-head"><h2>Received goods</h2></div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Goods receipt</th><th>Supplier</th><th>Date</th><th>Warehouse</th><th className="r">Phones</th><th className="r">Original value</th></tr></thead>
            <tbody>
              {lc.receipts.length === 0 && <tr><td colSpan={6} className="empty">No goods receipts chosen yet.</td></tr>}
              {lc.receipts.map((r: any) => (
                <tr key={r.id}>
                  <td><Link href={`/documents/${r.id}`} className="m">{r.doc_no}</Link>
                    {r.earlier && <div className="lc-note">Already carries {r.earlier}. This adds to it.</div>}</td>
                  <td>{r.supplier ?? "—"}</td><td>{r.doc_date}</td><td>{r.warehouse ?? "—"}</td>
                  <td className="r">{r.phones}</td><td className="r">{money(r.original_value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {lc.excluded.length > 0 && (
        <section className="card lc-excluded">
          <div className="card-head"><h2>Not eligible in this version</h2></div>
          <div className="card-body">
            <p>
              These lines are not IMEI-tracked phones. In this version they get none of the charges:
              everything is spread over the phones only.
            </p>
            <ul>
              {lc.excluded.map((x: any) => (
                <li key={`${x.receipt_no}-${x.line_no}`}><span className="m">{x.receipt_no}</span> line {x.line_no} · {x.item_name} · {x.qty} · {money(x.value)}</li>
              ))}
            </ul>
            {head.excluded_ack_at ? (
              <p className="lc-ack">Acknowledged by {head.excluded_ack_by ?? "—"} · {when(head.excluded_ack_at)}</p>
            ) : draft && mayPost ? (
              <LandedCostStep id={id} step="acknowledge" label="I understand — spread the charges over the phones only" />
            ) : null}
          </div>
        </section>
      )}

      {!draft && (
        <section className="card">
          <div className="card-head"><h2>Additional charges</h2></div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Cost type</th><th>Payee</th><th>Source</th><th>Spread</th><th className="r">Amount</th><th className="r">In {base}</th><th>Credited to</th></tr></thead>
              <tbody>
                {lc.charges.map((c: any) => (
                  <tr key={c.id}>
                    <td>{c.cost_type}{c.description ? <div className="m" style={{ color: "var(--muted)" }}>{c.description}</div> : null}</td>
                    <td>{c.payee ? (c.owed_account ? <Link href={`/payables/couriers/${c.partner_id}`}>{c.payee}</Link> : c.payee) : "—"}</td>
                    <td className="m">{c.source_doc_id ? <Link href={`/documents/${c.source_doc_id}`}>{c.source_doc_no}</Link> : c.source_entry_no ?? c.reference ?? "—"}</td>
                    <td>{METHOD[c.method]}</td>
                    <td className="r">{money(c.fc_amount)} {c.currency}
                      {c.currency !== base && <div className="m" style={{ color: "var(--muted)" }}>at {c.exchange_rate} on {c.rate_date}{c.rate_entered_by ? `, by ${c.rate_entered_by}` : ""}</div>}</td>
                    <td className="r">{money(c.base_amount)}</td>
                    <td className="m">{c.owed_account ? <>{c.owed_account} <span className="subline">owed to the payee</span></> : c.clearing_account}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <h2>Allocation</h2>
          <span className="page-sub">
            {allocated ? `${units.length} phones` : head.doc_status === "DRAFT" ? "Calculate to see each phone's share" : ""}
          </span>
        </div>
        {units.length === 0 ? (
          <div className="empty">No IMEI-tracked phones on the chosen receipts.</div>
        ) : (
          <div className="lc-alloc">
            <div className="lc-alloc-head" aria-hidden="true">
              <span>Product variant</span><span className="r">Original</span><span className="r">Added</span><span className="r">Final</span>
            </div>
            {variants.map((v) => (
              <details key={v.itemId} className="lc-variant">
                <summary>
                  <span>{v.name} <span className="m lc-count">{v.phones} phone{v.phones === 1 ? "" : "s"}</span></span>
                  <span className="r">{allocated ? money(v.original) : "—"}</span>
                  <span className="r">{allocated ? money(v.added) : "—"}</span>
                  <span className="r"><strong>{allocated ? money(v.original + v.added) : "—"}</strong></span>
                </summary>
                <table className="table lc-imeis">
                  <thead><tr><th>IMEI</th><th>Receipt</th><th className="r">Original cost</th><th className="r">Added</th><th className="r">Final cost</th><th>Now</th></tr></thead>
                  <tbody>
                    {v.rows.map((p: any) => (
                      <tr key={p.serial_id}>
                        <td className="m">{p.serial_no}</td>
                        <td className="m">{p.receipt_no}</td>
                        <td className="r">{p.original_cost != null ? money(p.original_cost) : "—"}</td>
                        <td className="r">{p.allocated != null ? money(p.allocated) : "—"}</td>
                        <td className="r">{p.allocated != null ? money(Number(p.original_cost) + Number(p.allocated)) : "—"}</td>
                        <td>{STATUS_NOW[p.status] ?? p.status ?? "—"}
                          {p.treatment && <span className="lc-treat"> · {TREATMENT[p.treatment] ?? p.treatment}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            ))}
            {allocated && (
              <div className="lc-alloc-foot">
                <span>Total</span><span className="r">{money(totals.original)}</span>
                <span className="r">{money(totals.added)}</span><span className="r"><strong>{money(totals.original + totals.added)}</strong></span>
              </div>
            )}
          </div>
        )}
      </section>

      {mayPost && (
        <section className="lc-next">
          {draft && (
            <>
              <LandedCostStep id={id} step="calculate" label="Calculate" prominent={!head.calculated_at || needsAck} />
              {head.calculated_at && !needsAck && (
                <LandedCostStep id={id} step="post" label="Post landed cost" prominent
                  confirm={`Post ${head.doc_no}? Each phone's cost changes and a journal entry is written. To undo it later you reverse it.`} />
              )}
              <LandedCostStep id={id} step="delete" label="Discard draft" confirm="Discard this draft?" />
            </>
          )}
          {head.doc_status === "POSTED" && can(user, "documents.void") && (
            <LandedCostStep id={id} step="reverse" label="Reverse landed cost"
              confirm="Reverse this landed cost? Every phone's cost goes back and a reversing entry is written.">
              <label htmlFor="lc-reason" className="lbl">Why</label>
              <input id="lc-reason" name="reason" required placeholder="e.g. Freight bill was for another shipment" />
            </LandedCostStep>
          )}
        </section>
      )}

      <DocumentAttachments
        documentId={id}
        attachments={attachments as never}
        upload={uploadAttachment}
        remove={deleteAttachment}
        storageReady={storageConfigured()}
      />
    </>
  );
}
