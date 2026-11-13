import { todayLocal } from "@/lib/format";
import { notFound } from "next/navigation";
import { requireFaPoster } from "@/lib/fa-access";
import { sql } from "@/lib/db";
import { seenLocations } from "@/lib/branch-scope";
import { assetList, faBranches } from "@/lib/fixed-assets";
import { transferAssetAction } from "@/lib/fa-actions";
import { trySplit } from "@/lib/fa-split";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { FaActionForm } from "@/components/fa-move-forms";
import { UnitPicker } from "@/components/fa-unit-picker";

export const metadata = { title: "Transfer asset" };
const money = (s: string | number) => Number(s).toLocaleString("en-US", { maximumFractionDigits: 2 });
type SP = Record<string, string | string[] | undefined>;

/**
 * An asset, or some of its units, to another branch: cost and accumulated
 * depreciation move with it, history stays. Some units are split off first,
 * and the preview is worked out on that split part, as posting will do it.
 */
export default async function TransferAsset({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requireFaPoster();
  const co = user.companyId;
  const [[a], branches, units] = await Promise.all([
    assetList(co, await seenLocations(), id), faBranches(co),
    sql`select u.id, u.code, b.name as branch, f.status from fa_unit u join fixed_asset f on f.id = u.asset_id join location b on b.id = f.branch_id
         where u.asset_id = ${id} order by u.seq`,
  ]);
  if (!a) notFound();
  const all = (units as any[]).map((u) => u.id as string);
  const asked = ([] as string[]).concat(sp.unit ?? []).filter((x) => all.includes(x));
  const chosen = units.length > 1 ? (sp.unit === undefined ? all : asked) : [];
  const partial = chosen.length > 0 && chosen.length < all.length;
  // What moves: the whole asset, or the chosen units' own cost and share of what is posted.
  const moving = partial
    ? await trySplit(co, user.id, id, chosen, async (tx, cid) => (await tx`
        select f.acquisition_cost::text as cost, coalesce((select sum(amount) from fa_depreciation where asset_id = f.id and journal_line_id is not null), 0)::text as accumulated
          from fixed_asset f where f.id = ${cid}`)[0])
    : { cost: a.acquisition_cost, accumulated: a.accumulated };
  const [acct] = await sql`select a.code as asset, x.code as accum from fa_category c join account a on a.id = c.asset_account_id
                             join account x on x.id = c.accum_account_id where c.id = ${a.category_id}`;
  const today = todayLocal();
  const codes = (units as any[]).filter((u) => chosen.includes(u.id)).map((u) => u.code);
  return (
    <div className="ie">
      <Breadcrumbs trail={[{ label: "Fixed Assets", href: "/fixed-assets" }, { label: "Asset Register", href: "/fixed-assets/register" }, { label: a.code, href: `/fixed-assets/${a.id}` }, { label: "Transfer" }]} />
      <header className="ie-title"><h1>{units.length > 1 ? "Transfer asset units" : `Transfer ${a.name}`}</h1><p>{a.name} · {a.code} · now at {a.branch}</p></header>
      <div className="fam">
        {units.length > 1 && <UnitPicker units={units as never} selected={chosen} verb="transfer to another branch" />}
        <section className="ie-card">
          <h3>Transfer details</h3>
          <FaActionForm action={transferAssetAction} submit={partial ? `Post transfer of ${chosen.length} unit${chosen.length === 1 ? "" : "s"}` : "Post transfer"} disabled={units.length > 1 && chosen.length === 0}>
            <input type="hidden" name="id" value={a.id} />
            {partial && chosen.map((u) => <input key={u} type="hidden" name="unit" value={u} />)}
            <div className="ie-grid3">
              <label className="ie-field"><span>To branch</span>
                <select name="to_branch_id" required defaultValue="">
                  <option value="" disabled>Choose…</option>
                  {branches.filter((b) => b.id !== a.branch_id).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select></label>
              <label className="ie-field"><span>Effective date</span><input type="date" name="date" defaultValue={today} required /></label>
              <label className="ie-field"><span>Reason</span><input name="note" placeholder="e.g. branch use" /></label>
            </div>
          </FaActionForm>
        </section>
        <section className="ie-card">
          <h3>Journal preview</h3>
          {partial && <p className="fam-units">{codes.join(", ")} · {a.branch} → the new branch. They become an asset of their own; the rest of {a.code} stays.</p>}
          <p className="ie-note" style={{ marginTop: 0 }}>One journal voucher, between branches on the same accounts. Cost and depreciation history are kept; cash does not move. Depreciation from the transfer month on is posted at the new branch.</p>
          <table className="ie-table">
            <thead><tr><th>Account</th><th>Branch</th><th className="r">Debit</th><th className="r">Credit</th></tr></thead>
            <tbody>
              <tr><td className="mono">{acct.asset} cost</td><td>New branch</td><td className="r">{money(moving.cost)}</td><td /></tr>
              <tr><td className="mono">{acct.asset} cost</td><td>{a.branch}</td><td /><td className="r">{money(moving.cost)}</td></tr>
              {Number(moving.accumulated) > 0 && <>
                <tr><td className="mono">{acct.accum} accumulated</td><td>{a.branch}</td><td className="r">{money(moving.accumulated)}</td><td /></tr>
                <tr><td className="mono">{acct.accum} accumulated</td><td>New branch</td><td /><td className="r">{money(moving.accumulated)}</td></tr>
              </>}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
