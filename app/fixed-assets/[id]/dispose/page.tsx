import { todayLocal } from "@/lib/format";
import { notFound } from "next/navigation";
import { requireFaPoster } from "@/lib/fa-access";
import { sql } from "@/lib/db";
import { seenLocations } from "@/lib/branch-scope";
import { assetList } from "@/lib/fixed-assets";
import { disposalPreview } from "@/lib/fa-move";
import { disposeAssetAction } from "@/lib/fa-actions";
import { trySplit } from "@/lib/fa-split";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { FaActionForm } from "@/components/fa-move-forms";
import { UnitPicker } from "@/components/fa-unit-picker";

export const metadata = { title: "Dispose of asset" };
const money = (s: string) => Number(s).toLocaleString("en-US", { maximumFractionDigits: 2 });
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Taking an asset, or some of its units, off the books: the date, why, and
 * what it fetched. The journal is worked out and shown first; posting it is a
 * second, deliberate step. Some units are split off and disposed of as an
 * asset of their own, and the preview is that same disposal, worked out and
 * undone.
 */
export default async function DisposeAsset({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requireFaPoster();
  const co = user.companyId;
  const [[a], units] = await Promise.all([
    assetList(co, await seenLocations(), id),
    sql`select u.id, u.code, b.name as branch, f.status from fa_unit u join fixed_asset f on f.id = u.asset_id join location b on b.id = f.branch_id
         where u.asset_id = ${id} order by u.seq`,
  ]);
  if (!a) notFound();
  const allUnits = (units as any[]).map((u) => u.id as string);
  const chosen = units.length > 1 ? (sp.unit === undefined ? allUnits : ([] as string[]).concat(sp.unit).filter((x) => allUnits.includes(x))) : [];
  const partial = chosen.length > 0 && chosen.length < allUnits.length;
  const today = todayLocal();
  const spDate = one(sp.date), spProceeds = one(sp.proceeds), spAccount = one(sp.account);
  const date = spDate && /^\d{4}-\d{2}-\d{2}$/.test(spDate) ? spDate : today;
  const proceeds = spProceeds && /^\d+(\.\d{1,4})?$/.test(spProceeds.replace(/,/g, "")) ? spProceeds.replace(/,/g, "") : "0";
  const [p, accounts] = await Promise.all([
    partial
      ? trySplit(co, user.id, id, chosen, (tx, cid) => disposalPreview(co, { assetId: cid, date, proceeds, proceedsAccountId: spAccount || null }, tx))
      : disposalPreview(co, { assetId: id, date, proceeds, proceedsAccountId: spAccount || null }),
    sql`select id, code, name from account where company_id = ${co} and is_postable and is_active and not is_control
          and account_type = 'ASSET' order by is_cash_account desc, is_bank_account desc, code`,
  ]);
  const gain = Number(p.gain);
  const codes = (units as any[]).filter((u) => chosen.includes(u.id)).map((u) => u.code);
  return (
    <div className="ie">
      <Breadcrumbs trail={[{ label: "Fixed Assets", href: "/fixed-assets" }, { label: "Asset Register", href: "/fixed-assets/register" }, { label: a.code, href: `/fixed-assets/${a.id}` }, { label: "Dispose" }]} />
      <header className="ie-title"><h1>{units.length > 1 ? "Dispose asset units" : `Dispose of ${a.name}`}</h1><p>{a.name} · {a.code} · {a.category} · {a.branch}</p></header>
      <div className="fam">
        {units.length > 1 && <UnitPicker units={units as never} selected={chosen} verb="dispose of" />}
        <section className="ie-card">
          <h3>Disposal details</h3>
          <form method="get" className="ie-grid4">
            {units.length > 1 && chosen.map((u) => <input key={u} type="hidden" name="unit" value={u} />)}
            <label className="ie-field"><span>Disposal date</span><input type="date" name="date" defaultValue={date} required /></label>
            <label className="ie-field"><span>Sale proceeds</span>
              <span className="ie-money"><i>MMK</i><input name="proceeds" defaultValue={proceeds === "0" ? "" : proceeds} inputMode="decimal" placeholder="0" /></span></label>
            <label className="ie-field"><span>Proceeds to</span>
              <select name="account" defaultValue={spAccount ?? ""}>
                <option value="">No proceeds</option>
                {(accounts as any[]).map((x) => <option key={x.id} value={x.id}>{x.code} · {x.name}</option>)}
              </select></label>
            <div className="ie-field"><span>&nbsp;</span><button className="ie-btn">Work it out</button></div>
          </form>
          {partial && <p className="fam-units">{codes.join(", ")}: {codes.length} of {units.length} units. They become an asset of their own and are disposed of; the rest of {a.code} carries on.</p>}
          <dl className="fac-sum fam-sum">
            <div><dt>Cost</dt><dd>{money(p.cost)}</dd></div>
            <div><dt>Accumulated depreciation</dt><dd>{money(p.accumulated)}</dd></div>
            <div><dt>Net book value</dt><dd>{money(p.nbv)}</dd></div>
            <div><dt>{gain > 0 ? "Gain" : gain < 0 ? "Loss" : "Gain / loss"}</dt><dd className={gain > 0 ? "ok" : gain < 0 ? "bad" : undefined}>{money(String(Math.abs(gain)))}</dd></div>
          </dl>
          <p className="ie-note">Depreciation is counted up to {p.cutoff ?? "—"} and stops after it.</p>
        </section>

        <section className="ie-card">
          <h3>Journal preview</h3>
          <table className="ie-table">
            <thead><tr><th>Account</th><th className="r">Debit</th><th className="r">Credit</th></tr></thead>
            <tbody>{p.lines.map((l) => (
              <tr key={l.accountId}><td><span className="mono">{l.code}</span> · {l.name}</td>
                <td className="r">{l.debit !== "0" ? money(l.debit) : "—"}</td><td className="r">{l.credit !== "0" ? money(l.credit) : "—"}</td></tr>))}
            </tbody>
          </table>
          <p className="ie-note">The {partial ? "units'" : "asset's"} cost and accumulated depreciation leave the balance sheet; {gain === 0 ? "no gain or loss arises" : `the ${gain > 0 ? "gain" : "loss"} goes to profit and loss`}.
            {Number(p.proceeds) > 0 ? " The proceeds are received into the account chosen." : " No money changes hands."}</p>
          {p.blockers.length > 0 ? (
            <div className="fam-block">{p.blockers.map((b) => <p key={b}>{b}</p>)}</div>
          ) : (
            <FaActionForm action={disposeAssetAction} submit={partial ? `Post disposal of ${chosen.length} unit${chosen.length === 1 ? "" : "s"}` : "Post disposal"} disabled={units.length > 1 && chosen.length === 0}>
              <input type="hidden" name="id" value={a.id} /><input type="hidden" name="date" value={date} />
              {partial && chosen.map((u) => <input key={u} type="hidden" name="unit" value={u} />)}
              <input type="hidden" name="proceeds" value={proceeds} /><input type="hidden" name="proceeds_account_id" value={spAccount ?? ""} />
              <label className="ie-field"><span>Reason</span><input name="reason" required placeholder="e.g. sold, scrapped, stolen" /></label>
            </FaActionForm>
          )}
        </section>
      </div>
    </div>
  );
}
