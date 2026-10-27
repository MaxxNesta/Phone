import { notFound } from "next/navigation";
import { requireFaPoster } from "@/lib/fa-access";
import { sql } from "@/lib/db";
import { seenLocations } from "@/lib/branch-scope";
import { assetList } from "@/lib/fixed-assets";
import { disposalPreview } from "@/lib/fa-move";
import { disposeAssetAction } from "@/lib/fa-actions";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { FaActionForm } from "@/components/fa-move-forms";

export const metadata = { title: "Dispose of asset" };
const money = (s: string) => Number(s).toLocaleString("en-US", { maximumFractionDigits: 0 });
type SP = Record<string, string | undefined>;

/**
 * Taking an asset off the books: the date, why, and what it fetched. The
 * journal is worked out and shown first; posting it is a second, deliberate
 * step.
 */
export default async function DisposeAsset({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requireFaPoster();
  const co = user.companyId;
  const [a] = await assetList(co, await seenLocations(), id);
  if (!a) notFound();
  const today = new Date(Date.now() + 6.5 * 3600_000).toISOString().slice(0, 10);
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today;
  const proceeds = sp.proceeds && /^\d+(\.\d{1,4})?$/.test(sp.proceeds.replace(/,/g, "")) ? sp.proceeds.replace(/,/g, "") : "0";
  const [p, accounts] = await Promise.all([
    disposalPreview(co, { assetId: id, date, proceeds, proceedsAccountId: sp.account || null }),
    sql`select id, code, name from account where company_id = ${co} and is_postable and is_active and not is_control
          and account_type = 'ASSET' order by is_cash_account desc, is_bank_account desc, code`,
  ]);
  const gain = Number(p.gain);
  return (
    <div className="ie">
      <Breadcrumbs trail={[{ label: "Fixed Assets", href: "/fixed-assets" }, { label: a.code, href: `/fixed-assets/${a.id}` }, { label: "Dispose" }]} />
      <header className="ie-title"><h1>Dispose of {a.name}</h1><p>{a.code} · {a.category} · {a.branch}</p></header>
      <div className="fam">
        <section className="ie-card">
          <h3>Disposal</h3>
          <form method="get" className="ie-grid4">
            <label className="ie-field"><span>Disposal date</span><input type="date" name="date" defaultValue={date} required /></label>
            <label className="ie-field"><span>Sale proceeds</span>
              <span className="ie-money"><i>MMK</i><input name="proceeds" defaultValue={proceeds === "0" ? "" : proceeds} inputMode="decimal" placeholder="0" /></span></label>
            <label className="ie-field"><span>Proceeds to</span>
              <select name="account" defaultValue={sp.account ?? ""}>
                <option value="">No proceeds</option>
                {(accounts as any[]).map((x) => <option key={x.id} value={x.id}>{x.code} · {x.name}</option>)}
              </select></label>
            <div className="ie-field"><span>&nbsp;</span><button className="ie-btn">Work it out</button></div>
          </form>
          <dl className="fac-sum fam-sum">
            <div><dt>Cost</dt><dd>{money(p.cost)}</dd></div>
            <div><dt>Accumulated</dt><dd>{money(p.accumulated)}</dd></div>
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
          <p className="ie-note">The asset&apos;s cost and its accumulated depreciation leave the balance sheet; {gain === 0 ? "no gain or loss arises" : `the ${gain > 0 ? "gain" : "loss"} goes to profit and loss`}.
            {Number(p.proceeds) > 0 ? " The proceeds are received into the account chosen." : " No money changes hands."}</p>
          {p.blockers.length > 0 ? (
            <div className="fam-block">{p.blockers.map((b) => <p key={b}>{b}</p>)}</div>
          ) : (
            <FaActionForm action={disposeAssetAction} submit="Post disposal">
              <input type="hidden" name="id" value={a.id} /><input type="hidden" name="date" value={date} />
              <input type="hidden" name="proceeds" value={proceeds} /><input type="hidden" name="proceeds_account_id" value={sp.account ?? ""} />
              <label className="ie-field"><span>Reason</span><input name="reason" required placeholder="e.g. sold, scrapped, stolen" /></label>
            </FaActionForm>
          )}
        </section>
      </div>
    </div>
  );
}
