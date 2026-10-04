import Link from "next/link";
import { Banknote, TrendingUp, Smartphone, Users, Package, Clock, ShieldAlert, AlertTriangle } from "lucide-react";
import { currentUser, can } from "@/lib/auth";
import { retailDashboard } from "@/lib/phone";
import { money } from "@/lib/format";
import { Stat, compact } from "@/components/stat";
import { WeekBars } from "@/components/week-bars";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const user = await currentUser();
  if (!user) return null;
  const { denied } = await searchParams;
  const d = await retailDashboard(user.companyId);
  const seeCost = can(user, "cost.view");

  const change = d.yesterday.revenue > 0
    ? ((d.today.revenue - d.yesterday.revenue) / d.yesterday.revenue) * 100 : null;
  const gp = d.today.revenue - d.today.cost;
  const margin = d.today.revenue ? (gp / d.today.revenue) * 100 : 0;
  const date = new Date().toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Yangon" });

  return (
    <>
      <div className="page-head hero">
        <h1>Dashboard</h1>
        <p className="page-sub">{date}</p>
      </div>

      {denied && (
        <div className="alert" role="alert">Your role cannot open that page ({denied}). Ask a manager.</div>
      )}

      <div className="stats">
        <Stat icon={<Banknote size={20} />} label="Today's Sales" value={`${compact(d.today.revenue)} MMK`}
          note={change === null ? "No sales yesterday" : `${change >= 0 ? "+" : ""}${change.toFixed(1)}% vs yesterday`}
          noteTone={change === null ? undefined : change >= 0 ? "up" : "down"} />
        {seeCost && (
          <Stat icon={<TrendingUp size={20} />} tone="slate" label="Gross Profit" value={`${compact(gp)} MMK`}
            note={`${margin.toFixed(1)}% margin`} />
        )}
        <Stat icon={<Smartphone size={20} />} tone="violet" label="Phones Sold" value={`${d.today.phones} units`}
          note={`${d.yesterday.phones} yesterday`} />
        <Stat icon={<Users size={20} />} tone="amber" label="Receivables" value={`${compact(d.ar.owed)} MMK`}
          note={`${d.ar.customers} customer${d.ar.customers === 1 ? "" : "s"} due`} noteTone="warn" />
      </div>

      <div className="section-grid">
        <div className="card">
          <div className="card-head"><h2>Sales Performance</h2><span className="page-sub">Last 7 days · MMK</span></div>
          <div className="card-body"><WeekBars data={d.week as never} /></div>
        </div>
        <div className="card">
          <div className="card-head"><h2>Top Selling Models</h2><span className="page-sub">Last 30 days</span></div>
          <div className="card-body">
            {d.topModels.length === 0 && <p className="page-sub">No phones sold yet.</p>}
            {d.topModels.map((m: any) => (
              <div className="listrow" key={m.model}>
                <span className="thumb"><Smartphone size={18} aria-hidden="true" /></span>
                <span className="grow"><div className="prod-name">{m.model}</div><div className="prod-sub">{m.sold} sold</div></span>
                <span className="num">{compact(m.revenue)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="section-grid">
        <div className="card">
          <div className="card-head"><h2>Recent Sales</h2><Link href="/sales/invoices">View all</Link></div>
          <table>
            <thead><tr><th>Invoice</th><th>Customer / Item</th><th className="num">Total</th><th>Status</th></tr></thead>
            <tbody>
              {d.recent.map((r: any) => (
                <tr key={r.id}>
                  <td className="m"><Link href={`/documents/${r.id}`}>{r.doc_no}</Link></td>
                  <td>{r.partner_code === "WALKIN" ? "Walk-in" : r.customer}{r.item ? ` · ${r.item}` : ""}</td>
                  <td className="num">{money(r.total)}</td>
                  <td>
                    {r.outstanding <= 0.005 ? <span className="pill ok">Paid</span>
                      : r.outstanding < r.total - 0.005 ? <span className="pill warn">Partial</span>
                      : <span className="pill warn">On account</span>}
                  </td>
                </tr>
              ))}
              {d.recent.length === 0 && <tr><td colSpan={4} className="page-sub">No sales yet.</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="card-head"><h2>Low Stock</h2><span className="page-sub">Selling, nearly out</span></div>
          <div className="card-body">
            {d.low.length === 0 && <p className="page-sub">Nothing selling is running out.</p>}
            {d.low.map((l: any) => (
              <div className="listrow" key={l.name}>
                <span className="grow">
                  <div>{l.name}</div>
                  <div className="low" style={{ fontSize: "var(--t-sm)" }}>{l.left_} unit{l.left_ === 1 ? "" : "s"} left</div>
                </span>
                <span style={{ width: 110 }}>
                  <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.max(8, (l.left_ / 3) * 100)}%` }} /></div>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="stats">
        {seeCost && (
          <Stat icon={<Package size={20} />} tone="slate" label="Inventory Value" value={`${compact(d.stock.value)} MMK`}
            note={<Link href="/inventory">Inventory summary</Link>} />
        )}
        <Stat icon={<Clock size={20} />} tone="amber" label="Aged Phones" value={d.aged}
          note={<Link href="/reports/phone-stock">Unsold over 90 days</Link>} noteTone={d.aged ? "warn" : undefined} />
        <Stat icon={<ShieldAlert size={20} />} tone="violet" label="Warranties Ending" value={d.ending}
          note={<Link href="/inventory/warranty?ending=30">Within 30 days</Link>} />
        {d.bad.length > 0 && (
          <Stat icon={<AlertTriangle size={20} />} tone="amber" label="Serial / Stock Mismatch" value={d.bad.length}
            note={d.bad.map((b: any) => `${b.name}: ${b.serials} IMEIs vs ${b.on_hand} on hand`).join("; ")} noteTone="down" />
        )}
      </div>

      <p className="page-sub"><Link href="/overview">Detailed business overview →</Link></p>
    </>
  );
}
