import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { sql } from "@/lib/db";
import { seenLocations } from "@/lib/branch-scope";
import { assetList, faBranches } from "@/lib/fixed-assets";
import { transferAssetAction } from "@/lib/fa-actions";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { FaActionForm } from "@/components/fa-move-forms";

export const metadata = { title: "Transfer asset" };
const money = (s: string) => Number(s).toLocaleString("en-US", { maximumFractionDigits: 0 });

/** One asset to another branch: cost and accumulated depreciation move with it, history stays. */
export default async function TransferAsset({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission("accounting.post");
  const co = user.companyId;
  const [[a], branches] = await Promise.all([assetList(co, await seenLocations(), id), faBranches(co)]);
  if (!a) notFound();
  const [acct] = await sql`select a.code as asset, x.code as accum from fa_category c join account a on a.id = c.asset_account_id
                             join account x on x.id = c.accum_account_id where c.id = ${a.category_id}`;
  const today = new Date(Date.now() + 6.5 * 3600_000).toISOString().slice(0, 10);
  return (
    <div className="ie">
      <Breadcrumbs trail={[{ label: "Fixed Assets", href: "/fixed-assets" }, { label: a.code, href: `/fixed-assets/${a.id}` }, { label: "Transfer" }]} />
      <header className="ie-title"><h1>Transfer {a.name}</h1><p>{a.code} · now at {a.branch}</p></header>
      <div className="fam">
        <section className="ie-card">
          <FaActionForm action={transferAssetAction} submit="Post transfer">
            <input type="hidden" name="id" value={a.id} />
            <div className="ie-grid3">
              <label className="ie-field"><span>To branch</span>
                <select name="to_branch_id" required defaultValue="">
                  <option value="" disabled>Choose…</option>
                  {branches.filter((b) => b.id !== a.branch_id).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select></label>
              <label className="ie-field"><span>Effective date</span><input type="date" name="date" defaultValue={today} required /></label>
              <label className="ie-field"><span>Note</span><input name="note" placeholder="e.g. moved with the new store" /></label>
            </div>
          </FaActionForm>
        </section>
        <section className="ie-card">
          <h3>What posts</h3>
          <p className="ie-note" style={{ marginTop: 0 }}>One journal voucher, between branches on the same accounts. Cost and depreciation history are kept; cash does not move. Depreciation from the transfer month on is posted at the new branch.</p>
          <table className="ie-table">
            <thead><tr><th>Account</th><th>Branch</th><th className="r">Debit</th><th className="r">Credit</th></tr></thead>
            <tbody>
              <tr><td className="mono">{acct.asset} cost</td><td>New branch</td><td className="r">{money(a.acquisition_cost)}</td><td /></tr>
              <tr><td className="mono">{acct.asset} cost</td><td>{a.branch}</td><td /><td className="r">{money(a.acquisition_cost)}</td></tr>
              {Number(a.accumulated) > 0 && <>
                <tr><td className="mono">{acct.accum} accumulated</td><td>{a.branch}</td><td className="r">{money(a.accumulated)}</td><td /></tr>
                <tr><td className="mono">{acct.accum} accumulated</td><td>New branch</td><td /><td className="r">{money(a.accumulated)}</td></tr>
              </>}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
