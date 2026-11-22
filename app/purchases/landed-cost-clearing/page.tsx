import { BranchScope } from "@/components/branch-scope";
import { seenLocations } from "@/lib/branch-scope";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Inbox, Clock, AlertTriangle } from "lucide-react";
import { requirePermission, can } from "@/lib/auth";
import { money, shortDate } from "@/lib/format";
import { getCompany } from "@/lib/queries";
import { hasModule } from "@/lib/plans";
import { clearingLeftovers, clearingWriteOffs, CLEARING_STALE_DAYS } from "@/lib/landed-cost-queries";
import { Stat } from "@/components/stat";
import { HelpHint } from "@/components/help-hint";
import { ClearingWriteOff } from "@/components/clearing-writeoff";

export const metadata = { title: "Left in landed cost clearing" };

/**
 * Bills booked to Landed Cost Clearing (or a cost type's own clearing
 * account) that no posted landed cost has spread onto the goods. Each is
 * either spread by a landed cost, or written off to Landed Cost Variance.
 */
export default async function LandedCostClearing() {
  const user = await requirePermission("cost.view");
  if (!hasModule(await getCompany(), "landed_cost")) notFound();
  const locs = await seenLocations();
  const [rows, writeOffs] = await Promise.all([
    clearingLeftovers(user.companyId, locs),
    clearingWriteOffs(user.companyId),
  ]);
  const left = rows.reduce((s, r) => s + r.left, 0);
  const stale = rows.filter((r) => r.days > CLEARING_STALE_DAYS);
  const oldest = rows.reduce((m, r) => Math.max(m, r.days), 0);
  const mayWrite = can(user, "purchase.post") && can(user, "accounting.post");
  const mayReverse = can(user, "documents.void");

  return (
    <>
      <div className="page-head hero">
        <span className="eyebrow">Purchases</span>
        <h1>Left in landed cost clearing</h1>
        <BranchScope />
        <HelpHint label="What this lists">
          Freight, duty and other import bills are first booked to a clearing
          account and then spread onto the goods by a landed cost. A bill that
          no posted landed cost has spread stays in clearing, so the goods are
          carried at less than they cost. Spread it from Landed costs, or, if
          there is nothing left to spread it onto, write it off to Landed Cost
          Variance (5940), which is part of cost of sales.
        </HelpHint>
        <p className="page-sub">Import bills not yet spread onto any goods.</p>
      </div>

      <div className="stats">
        <Stat icon={<Inbox size={20} />} label="Left in clearing" value={`${money(left)} MMK`}
          note={`${rows.length} bill line${rows.length === 1 ? "" : "s"}`} />
        <Stat icon={<AlertTriangle size={20} />} tone="amber" label={`Over ${CLEARING_STALE_DAYS} days`}
          value={`${money(stale.reduce((s, r) => s + r.left, 0))} MMK`}
          note={`${stale.length} line${stale.length === 1 ? "" : "s"}`} noteTone={stale.length ? "warn" : undefined} />
        <Stat icon={<Clock size={20} />} tone="slate" label="Oldest" value={`${oldest} days`}
          note={oldest > CLEARING_STALE_DAYS ? "spread or write it off" : "since the bill was booked"}
          noteTone={oldest > CLEARING_STALE_DAYS ? "warn" : undefined} />
      </div>

      <div className="card">
        <div className="card-head"><h2>Bills not yet spread</h2><span className="page-sub">Oldest first</span></div>
        {rows.length === 0 ? (
          <div className="empty">Every bill in clearing has been spread onto goods.</div>
        ) : (
          <div className="tablewrap">
            <table>
              <thead>
                <tr><th>Bill</th><th>Booked</th><th className="r">Age</th><th>Account</th><th>Payee</th>
                  <th className="r">Amount</th><th className="r">Used</th><th className="r">Left (MMK)</th><th /></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="m">
                      {r.doc_id ? <Link href={`/documents/${r.doc_id}`}>{r.doc_no}</Link> : r.entry_no}
                      {r.memo && <div className="subline">{r.memo}</div>}
                    </td>
                    <td>{shortDate(r.entry_date)}</td>
                    <td className="r" style={{ color: r.days > CLEARING_STALE_DAYS ? "var(--warn)" : undefined }}>
                      {r.days} day{r.days === 1 ? "" : "s"}
                    </td>
                    <td className="wrap">{r.account}</td>
                    <td className="wrap">{r.partner ?? "—"}</td>
                    <td className="r">
                      {money(r.amount)}
                      {r.currency !== "MMK" && <div className="subline">{money(r.fc_amount)} {r.currency}</div>}
                    </td>
                    <td className="r">{money(r.used + r.written)}</td>
                    <td className="r"><strong>{money(r.left)}</strong></td>
                    <td className="tight">
                      {r.held ? (
                        <Link className="btn ghost tiny" href={`/purchases/landed-costs/${r.held_id}`}>In draft {r.held}</Link>
                      ) : (
                        <>
                          <Link className="btn ghost tiny" href="/purchases/landed-costs/new">Spread</Link>
                          {mayWrite && (
                            <ClearingWriteOff lineId={r.id} label="Write off"
                              title={`Write off ${money(r.left)} MMK to Landed Cost Variance? Cost of sales goes up by that amount and the bill leaves this list.`} />
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td colSpan={7}>Left in clearing</td><td className="r"><strong>{money(left)}</strong></td><td /></tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {writeOffs.length > 0 && (
        <div className="card">
          <div className="card-head"><h2>Written off</h2><span className="page-sub">Standing write-offs, newest first</span></div>
          <div className="tablewrap">
            <table>
              <thead><tr><th>Entry</th><th>Date</th><th>Bill entry</th><th>Why</th><th>By</th><th className="r">Amount (MMK)</th><th /></tr></thead>
              <tbody>
                {writeOffs.map((w) => (
                  <tr key={w.id}>
                    <td className="m">{w.entry_no}</td>
                    <td>{shortDate(w.entry_date)}</td>
                    <td className="m">{w.bill_entry_no}</td>
                    <td className="wrap">{w.reason}</td>
                    <td>{w.by ?? "—"}</td>
                    <td className="r">{money(w.amount)}</td>
                    <td className="tight">
                      {mayReverse && (
                        <ClearingWriteOff writeOffId={w.id} label="Reverse"
                          title="Reverse this write-off? A reversing entry is written and the bill goes back on the list." />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
