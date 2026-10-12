import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { seenLocations } from "@/lib/branch-scope";
import { postedReceipts, landedCostTemplates } from "@/lib/landed-cost-queries";
import { createLandedCostAction } from "@/lib/landed-cost-actions";
import { ErpCrumbs } from "@/components/erp-worklist";

export default async function NewLandedCost({ searchParams }: { searchParams: Promise<{ gr?: string }> }) {
  const user = await requirePermission("purchase.post");
  const { gr } = await searchParams;
  const [receipts, templates] = await Promise.all([
    postedReceipts(user.companyId, await seenLocations()),
    landedCostTemplates(user.companyId, true),
  ]) as [any[], any[]];
  const today = new Date().toISOString().slice(0, 10);
  // The receipt it was opened from goes first, ticked.
  const ordered = gr ? [...receipts.filter((r) => r.id === gr), ...receipts.filter((r) => r.id !== gr)] : receipts;

  return (
    <>
      <ErpCrumbs steps={[{ label: "Landed costs", href: "/purchases/landed-costs" }, { label: "New" }]} />
      <div className="page-head">
        <span className="eyebrow">Purchases</span>
        <h1>New landed cost</h1>
      </div>

      <form action={createLandedCostAction} className="lc-new">
        <section className="card">
          <div className="card-head"><h2>Shipment</h2></div>
          <div className="card-body">
            <div className="row">
              <div className="field">
                <label htmlFor="doc_date">Date</label>
                <input id="doc_date" name="doc_date" type="date" defaultValue={today} max={today} required />
              </div>
              <div className="field">
                <label htmlFor="template_id">Template</label>
                <select id="template_id" name="template_id" defaultValue={templates[0]?.id ?? ""}>
                  <option value="">No template</option>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <span className="hint">Fills in the usual charges and how each is spread.</span>
              </div>
              <div className="field">
                <label htmlFor="shipment_ref">Shipment reference</label>
                <input id="shipment_ref" name="shipment_ref" placeholder="e.g. GZ-2410-07" />
              </div>
              <div className="field">
                <label htmlFor="carrier_ref">Carrier or tracking number <span className="opt">optional</span></label>
                <input id="carrier_ref" name="carrier_ref" />
              </div>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Received goods</h2>
            <span className="page-sub">Posted goods receipts only. Choose one or more.</span>
          </div>
          {ordered.length === 0 ? (
            <div className="empty">No posted goods receipts yet. Receive the goods first.</div>
          ) : (
            <div className="lc-picklist" role="group" aria-label="Goods receipts">
              {ordered.map((r) => (
                <label key={r.id} className="lc-pick">
                  <input type="checkbox" name="receipt_id" value={r.id} defaultChecked={r.id === gr} />
                  <span className="lc-pick-main">
                    <span className="m">{r.doc_no}</span>
                    <span>{r.supplier ?? "—"}</span>
                  </span>
                  <span className="lc-pick-meta">
                    {r.doc_date} · {r.warehouse ?? "—"} · {r.phones} phone{r.phones === 1 ? "" : "s"}
                    {r.landed_costs > 0 && <span className="lc-note"> · already has {r.landed_costs} landed cost{r.landed_costs === 1 ? "" : "s"}</span>}
                  </span>
                </label>
              ))}
            </div>
          )}
        </section>

        <div className="lc-actions">
          <Link href="/purchases/landed-costs" className="btn ghost">Cancel</Link>
          <button type="submit" className="btn">Create draft</button>
        </div>
      </form>
    </>
  );
}
