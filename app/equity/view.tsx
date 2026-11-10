import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { listShareholders, listTransfers, capitalLedger } from "@/lib/shares";
import { cancelShareTransferAction } from "@/lib/share-actions";
import { HelpHint } from "@/components/help-hint";
import { CancelTransfer } from "@/components/share-transfer-form";

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const TYPE: Record<string, string> = { ISSUE: "Issue", PURCHASE: "Purchase", TRANSFER: "Transfer" };
const SHARE: Record<string, string> = { EQUITY: "Equity", PREFERENCE: "Preference" };
export type EquityTab = "shareholders" | "transfers" | "balance" | "ledger";
const TABS: [EquityTab, string][] = [["shareholders", "Shareholders"], ["transfers", "Share transfers"], ["balance", "Balance"], ["ledger", "Ledger"]];

/**
 * Who owns the company. Four views of one record, each at its own address
 * under /equity: the owners, the transfers that moved shares, the balance
 * they leave (who owns what now) and the ledger behind it (how each balance
 * arose). Holdings are replayed from the posted transfers every time, so the
 * four can never disagree.
 */
export async function EquityView({ tab, p }: {
  tab: EquityTab; p: { holder?: string; from?: string; to?: string };
}) {
  const user = await requirePermission("accounting.view");
  const [holders, transfers, capLines] = await Promise.all([
    listShareholders(user.companyId),
    tab === "transfers" || tab === "ledger"
      ? listTransfers(user.companyId, tab === "ledger" ? { to: p.to, shareholderId: p.holder } : {})
      : Promise.resolve([] as any[]),
    tab === "ledger" ? capitalLedger(user.companyId, { holder: p.holder, to: p.to }) : Promise.resolve([]),
  ]);
  const totalIssued = holders.reduce((t, h) => t + h.equity + h.preference, 0);
  const totalCapital = holders.reduce((t, h) => t + h.capital, 0);
  const opt = (n: number | null) => (n == null ? <span className="subline">Not set</span> : fmt(n));

  return (
    <div className="ie">
      <header className="ie-title page-head">
        <h1>{TABS.find(([k]) => k === tab)![1]} <HelpHint label="About shareholders">A shareholder can have its own capital account: money paid in by cash or bank receipt to that account is its capital, shown in Balance and Ledger. Number of shares and price per share are typed in on the shareholder and post nothing. Numbered shares are optional: a shareholder holds none until an Issue gives it shares, and its folio number arrives with them. Issue and Purchase post to the ledger (money in for new capital, money out for a buy-back); a Transfer between owners only changes who holds the shares.</HelpHint></h1>
        <span className="actions">
          <Link href="/equity/shareholders/new" className="btn ghost">New shareholder</Link>
          <Link href="/equity/transfers/new" className="btn">New share transfer</Link>
        </span>
      </header>

      <nav className="seg sh-tabs" aria-label="Equity views">
        {TABS.map(([k, label]) => <Link key={k} href={`/equity/${k}`} data-active={tab === k || undefined}>{label}</Link>)}
      </nav>

      {tab === "shareholders" && (
        <section className="card">
          <div className="card-head"><h2>Shareholders</h2><span className="page-sub">{holders.length} · {fmt(totalIssued)} shares held</span></div>
          {holders.length === 0 ? (
            <div className="empty">No shareholders yet. Add one, then issue shares to give it a balance.</div>
          ) : (
            <div className="tablewrap"><table>
              <thead><tr><th>Code</th><th>Name</th><th>Type</th><th>Capital account</th><th className="r">Shares</th><th className="r">Price per share</th><th className="r">Capital</th>
                {totalIssued > 0 && <><th>Folio</th><th className="r">Issued equity</th><th className="r">Issued preference</th></>}<th /></tr></thead>
              <tbody>
                {holders.map((h) => (
                  <tr key={h.id}>
                    <td className="code">{h.code}</td>
                    <td><Link href={`/equity/ledger?holder=${h.id}`} style={{ color: "var(--link)" }}>{h.name}</Link></td>
                    <td>{h.is_company ? "Company" : "Person"}</td>
                    <td className="code">{h.account_code ? `${h.account_code} ${h.account_name}` : <span className="subline">None</span>}</td>
                    <td className="r">{opt(h.no_of_shares)}</td>
                    <td className="r">{opt(h.share_price)}</td>
                    <td className="r">{fmt(h.capital)}</td>
                    {totalIssued > 0 && <>
                      <td className="code">{h.folio_no ?? <span className="subline">After first issue</span>}</td>
                      <td className="r">{h.equity ? fmt(h.equity) : "—"}{h.ranges.EQUITY && <div className="subline">{h.ranges.EQUITY}</div>}</td>
                      <td className="r">{h.preference ? fmt(h.preference) : "—"}{h.ranges.PREFERENCE && <div className="subline">{h.ranges.PREFERENCE}</div>}</td>
                    </>}
                    <td className="tight"><Link href={`/equity/shareholders/${h.id}`} style={{ color: "var(--link)" }}>Edit</Link></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </section>
      )}

      {tab === "transfers" && (
        <section className="card">
          <div className="card-head"><h2>Share transfers</h2><span className="page-sub">{transfers.length}</span></div>
          {transfers.length === 0 ? <div className="empty">No share transfers yet. Start with an Issue.</div> : (
            <div className="tablewrap"><table>
              <thead><tr><th>No.</th><th>Date</th><th>Type</th><th>From</th><th>To</th><th>Share type</th><th className="r">Shares</th><th>Numbers</th><th className="r">Rate</th><th className="r">Amount</th><th>Journal</th><th /></tr></thead>
              <tbody>
                {transfers.map((t: any) => (
                  <tr key={t.id} style={t.status === "CANCELLED" ? { opacity: 0.55 } : undefined}>
                    <td className="code">{t.transfer_no}</td>
                    <td className="code">{t.transfer_date}</td>
                    <td><span className="pill">{TYPE[t.transfer_type]}</span>{t.status === "CANCELLED" && <> <span className="pill overdue">Cancelled</span></>}</td>
                    <td>{t.from_name ?? <span className="subline">Company</span>}{t.from_folio && <div className="subline">{t.from_folio}</div>}</td>
                    <td>{t.to_name ?? <span className="subline">Company</span>}{t.to_folio && <div className="subline">{t.to_folio}</div>}</td>
                    <td>{SHARE[t.share_type]}</td>
                    <td className="r">{fmt(t.no_of_shares)}</td>
                    <td className="code">{t.from_no}–{t.to_no}</td>
                    <td className="r">{fmt(t.rate)}</td>
                    <td className="r">{fmt(t.amount)}</td>
                    <td className="code">{t.entry_no ?? <span className="subline">None</span>}</td>
                    <td className="tight">{t.status === "POSTED" && <CancelTransfer id={t.id} no={t.transfer_no} action={cancelShareTransferAction} />}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </section>
      )}

      {tab === "balance" && (
        <section className="card">
          <div className="card-head"><h2>Capital balance</h2><span className="page-sub">What each owner has paid in, from the ledger</span></div>
          <div className="tablewrap"><table>
            <thead><tr><th>Shareholder</th><th>Capital account</th><th className="r">Shares</th><th className="r">Price per share</th><th className="r">Capital</th><th className="r">% of capital</th></tr></thead>
            <tbody>
              {holders.filter((h) => h.equity_account_id).map((h) => (
                <tr key={h.id}>
                  <td><Link href={`/equity/ledger?holder=${h.id}`} style={{ color: "var(--link)" }}>{h.name}</Link></td>
                  <td className="code">{h.account_code} {h.account_name}</td>
                  <td className="r">{opt(h.no_of_shares)}</td><td className="r">{opt(h.share_price)}</td>
                  <td className="r">{fmt(h.capital)}</td>
                  <td className="r">{totalCapital ? `${fmt(Math.round((h.capital / totalCapital) * 10000) / 100)} %` : "—"}</td>
                </tr>
              ))}
              {!holders.some((h) => h.equity_account_id) && <tr><td colSpan={6} className="empty">No shareholder has a capital account yet. Edit a shareholder to choose one.</td></tr>}
            </tbody>
            {totalCapital !== 0 && <tfoot><tr><td colSpan={4}>Total</td><td className="r">{fmt(totalCapital)}</td><td className="r">100 %</td></tr></tfoot>}
          </table></div>
        </section>
      )}

      {tab === "balance" && totalIssued > 0 && (
        <section className="card">
          <div className="card-head"><h2>Share balance</h2><span className="page-sub">Who owns what now</span></div>
          <div className="tablewrap"><table>
            <thead><tr><th>Shareholder</th><th>Folio</th><th>Share type</th><th className="r">Shares</th><th>Numbers</th><th className="r">% of shares</th><th className="r">Value</th></tr></thead>
            <tbody>
              {holders.flatMap((h) => (["EQUITY", "PREFERENCE"] as const)
                .filter((k) => (k === "EQUITY" ? h.equity : h.preference) > 0)
                .map((k) => {
                  const n = k === "EQUITY" ? h.equity : h.preference;
                  return (
                    <tr key={`${h.id}-${k}`}>
                      <td>{h.name}</td><td className="code">{h.folio_no}</td><td>{SHARE[k]}</td>
                      <td className="r">{fmt(n)}</td><td className="code">{h.ranges[k]}</td>
                      <td className="r">{totalIssued ? `${fmt(Math.round((n / totalIssued) * 10000) / 100)} %` : "—"}</td>
                      <td className="r">{fmt(h.value)}</td>
                    </tr>
                  );
                }))}
              {totalIssued === 0 && <tr><td colSpan={7} className="empty">No shares issued yet.</td></tr>}
            </tbody>
            {totalIssued > 0 && <tfoot><tr><td colSpan={3}>Total</td><td className="r">{fmt(totalIssued)}</td><td /><td className="r">100 %</td><td className="r">{fmt(holders.reduce((t, h) => t + h.value, 0))}</td></tr></tfoot>}
          </table></div>
        </section>
      )}

      {tab === "ledger" && (() => {
        const who = holders.find((h) => h.id === p.holder);
        // Oldest first, so the running balance reads down the page.
        const posted = [...transfers].filter((t: any) => t.status === "POSTED").reverse();
        const sign = (t: any) => (!who ? t.no_of_shares : t.to_shareholder_id === who.id ? t.no_of_shares : -t.no_of_shares);
        // What the shareholder held before the period: the balance the rows start from.
        const opening = who && p.from ? posted.filter((t: any) => t.transfer_date < p.from!).reduce((n: number, t: any) => n + sign(t), 0) : 0;
        const rows = p.from ? posted.filter((t: any) => t.transfer_date >= p.from!) : posted;
        let run = opening;
        const capOpening = p.from ? capLines.filter((l) => l.date < p.from!).reduce((n, l) => n + l.amount, 0) : 0;
        const capRows = p.from ? capLines.filter((l) => l.date >= p.from!) : capLines;
        let capRun = capOpening;
        return (<>
          <section className="card">
            <div className="card-head"><h2>Capital ledger{who ? ` · ${who.name}` : ""}</h2><span className="page-sub">Every entry on the capital accounts</span></div>
            <form method="get" className="card-body sh-filter">
              <div className="field"><label htmlFor="holder">Shareholder</label>
                <select id="holder" name="holder" defaultValue={p.holder ?? ""}>
                  <option value="">All shareholders</option>
                  {holders.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
                </select></div>
              <div className="field"><label htmlFor="from">From</label><input id="from" name="from" type="date" defaultValue={p.from ?? ""} /></div>
              <div className="field"><label htmlFor="to">To</label><input id="to" name="to" type="date" defaultValue={p.to ?? ""} /></div>
              <div className="field"><label aria-hidden="true">&nbsp;</label><button type="submit" className="tiny">Apply</button></div>
            </form>
            {capRows.length === 0 && !p.from ? <div className="empty">No entries on the capital accounts.</div> : (
              <div className="tablewrap"><table>
                <thead><tr><th>Date</th><th>Document</th><th>Reference</th><th>Description</th>{!who && <th>Shareholder</th>}<th>Account</th><th className="r">Amount</th><th className="r">Balance</th></tr></thead>
                <tbody>
                  {p.from && <tr className="sh-opening"><td colSpan={who ? 6 : 7}>Opening · before {p.from}</td><td className="r"><strong>{fmt(capOpening)}</strong></td></tr>}
                  {capRows.map((l) => {
                    capRun += l.amount;
                    return (
                      <tr key={l.id}>
                        <td className="code">{l.date}</td>
                        <td className="code"><Link href={l.doc_id ? `/documents/${l.doc_id}` : `/finance/general-ledger/${l.entry_id}`} style={{ color: "var(--link)" }}>{l.doc_no ?? l.entry_no}</Link></td>
                        <td className="code">{l.reference ?? ""}</td>
                        <td>{l.memo ?? ""}</td>
                        {!who && <td>{l.holder}</td>}
                        <td className="code">{l.account_code}</td>
                        <td className={`r ${l.amount < 0 ? "dr" : "cr"}`}>{fmt(l.amount)}</td>
                        <td className="r"><strong>{fmt(capRun)}</strong></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table></div>
            )}
          </section>
          {transfers.length > 0 && <section className="card">
            <div className="card-head"><h2>Share ledger{who ? ` · ${who.name}` : ""}</h2><span className="page-sub">How each share balance arose</span></div>
            {rows.length === 0 && !(who && p.from) ? <div className="empty">No submitted share transfers here.</div> : (
              <div className="tablewrap"><table>
                <thead><tr><th>Date</th><th>No.</th><th>Type</th><th>From</th><th>To</th><th>Share type</th><th>Numbers</th><th className="r">Shares</th>{who && <th className="r">Balance</th>}<th className="r">Amount</th></tr></thead>
                <tbody>
                  {who && p.from && (
                    <tr className="sh-opening"><td colSpan={8}>Opening · held before {p.from}</td><td className="r"><strong>{fmt(opening)}</strong></td><td /></tr>
                  )}
                  {rows.map((t: any) => {
                    const signed = sign(t);
                    run += signed;
                    return (
                      <tr key={t.id}>
                        <td className="code">{t.transfer_date}</td><td className="code">{t.transfer_no}</td><td>{TYPE[t.transfer_type]}</td>
                        <td>{t.from_name ?? <span className="subline">Company</span>}</td><td>{t.to_name ?? <span className="subline">Company</span>}</td>
                        <td>{SHARE[t.share_type]}</td><td className="code">{t.from_no}–{t.to_no}</td>
                        <td className={`r ${signed < 0 ? "cr" : "dr"}`}>{who ? (signed > 0 ? "+" : "−") : ""}{fmt(Math.abs(signed))}</td>
                        {who && <td className="r"><strong>{fmt(run)}</strong></td>}
                        <td className="r">{fmt(t.amount)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table></div>
            )}
          </section>}
        </>);
      })()}
    </div>
  );
}
