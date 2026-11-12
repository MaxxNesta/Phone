import { HelpHint } from "./help-hint";
import { money } from "@/lib/format";
import type { Reason } from "@/lib/stock-reasons";

/** Why two figures differ, as a small structured breakdown. */
export function GapBreakdown({ gap, items, unexplained, where }: {
  gap: number; items: { label: string; value: number; detail: string }[]; unexplained: number; where: string;
}) {
  return (
    <table className="sf sf-gap">
      <colgroup><col /><col className="sf-amtcol" /></colgroup>
      <tbody>
        <tr className="sf-g" data-tone={unexplained === 0 ? "other" : "bad"}>
          <td><span className="sf-dot" />Why it differs</td><td className="sf-amt">{money(gap)}</td>
        </tr>
        {items.map((w) => (
          <tr key={w.label} className="sf-l1" data-tone="other">
            <td><span className="sf-label">{w.label}<HelpHint label={w.label}>{w.detail}</HelpHint></span></td>
            <td className="sf-amt">{money(w.value)}</td>
          </tr>
        ))}
        {unexplained !== 0 && (
          <tr className="sf-l1" data-tone="bad">
            <td><span className="sf-label">Not explained by stock movements
              <HelpHint label="Not explained">Something was posted outside the usual documents. Open the {where} for this period to find the entry.</HelpHint></span></td>
            <td className="sf-amt">{money(unexplained)}</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

/** Plain wording for a reason, by where it sits in the statement. */
function phrase(r: Reason, place: "in" | "sold" | "other") {
  if (place === "in") {
    if (r.key.startsWith("void-")) return `Inventory returned from ${r.label}`;
    if (r.key === "landed") return "Landed costs added to stock (freight, duty)";
    return r.label;
  }
  if (place === "sold") return r.key === "delivered" ? "Customer deliveries" : r.label;
  return `Less: ${r.label.charAt(0).toLowerCase()}${r.label.slice(1)}`;
}

/**
 * Inventory movement & cost of sales, laid out the way an accountant reads it:
 * opening, what was added, less closing, the net outflow, less what left
 * without being sold, = cost of sales and deliveries; then the sales and
 * delivery breakdown, carriage inward when there is any, and the general
 * ledger lines it should agree with. Same colours and indents as StockFlow.
 */
export function InventoryMovement({ d }: { d: {
  opening: number; closing: number; additions: Reason[]; releases: Reason[];
  landedIn: number; carriage: { code: string; name: string; net: number } | null;
  cogsGl: number; cogsCredits: number; cogsCode: string; heldCode: string;
  heldClosing: number; heldIn: number; heldOut: number;
} }) {
  const sum = (l: Reason[]) => l.reduce((t, x) => t + x.value, 0);
  const added = sum(d.additions);
  const sold = d.releases.filter((r) => r.isCogs), notSold = d.releases.filter((r) => !r.isCogs);
  const outflow = sum(d.releases), cos = sum(sold);
  const carriage = d.carriage?.net ?? 0;
  const showCarriage = d.landedIn !== 0 || carriage !== 0;
  // What the ledger should hold as cost of sales: what was sold, less what came
  // back to it (returns, voided sales), less what still waits to be billed.
  const expectedGl = Math.round((cos - d.cogsCredits - (d.heldIn - d.heldOut)) * 100) / 100;
  const glGap = Math.round((d.cogsGl - expectedGl) * 100) / 100;
  const pct = (v: number) => (cos > 0 ? `${((v / cos) * 100).toFixed(0)}%` : "");

  const Head = ({ title, right }: { title: string; right?: string }) => (
    <tr className="sf-h"><td colSpan={3}>{title}</td><td className="sf-amt">{right}</td></tr>
  );
  const Band = ({ label, value, tone, help }: { label: string; value: number; tone?: string; help?: string }) => (
    <tr className="sf-total" data-tone={tone}><td colSpan={3}><span className="sf-label">{tone && <span className="sf-dot" />}{label}{help && <HelpHint label={label}>{help}</HelpHint>}</span></td>
      <td className="sf-amt">{money(value)}</td></tr>
  );

  return (
    <div className="tablewrap">
      <table className="sf">
        <colgroup><col /><col className="sf-barcol" /><col className="sf-pctcol" /><col className="sf-amtcol" /></colgroup>
        <tbody>
          <Head title="Inventory movement" right="Amount (MMK)" />
          <tr className="sf-l0"><td colSpan={3}>Opening inventory</td><td className="sf-amt">{money(d.opening)}</td></tr>
          <tr className="sf-g" data-tone="in"><td colSpan={3}><span className="sf-label"><span className="sf-dot" />Inventory added
            <HelpHint label="Inventory added">Everything that came onto the shelf in the period, by reason. Open the ? on a line for what it means.</HelpHint></span></td>
            <td className="sf-amt">{money(added)}</td></tr>
          {d.additions.map((r) => (
            <tr key={`in-${r.key}`} className="sf-l1" data-tone="in"><td colSpan={3}><span className="sf-label">{phrase(r, "in")}
              {r.attention && <span className="sf-tag">check</span>}<HelpHint label={r.label}>{r.detail}</HelpHint></span></td>
              <td className="sf-amt">{money(r.value)}</td></tr>
          ))}
          <tr className="sf-l0"><td colSpan={3}>Less: closing inventory</td><td className="sf-amt">({money(d.closing)})</td></tr>
          <Band label="Net inventory outflows" value={outflow}
            help="Opening plus added, less closing: everything that left the shelf in the period, sold or not." />
          {notSold.map((r) => (
            <tr key={`n-${r.key}`} className="sf-l0" data-tone="other"><td colSpan={3}><span className="sf-label"><span className="sf-dot" />{phrase(r, "other")}
              {r.attention && <span className="sf-tag">check</span>}<HelpHint label={r.label}>{r.detail}</HelpHint></span></td>
              <td className="sf-amt">({money(r.value)})</td></tr>
          ))}
          <Band label="Cost of sales and deliveries" value={cos} tone="sold"
            help="What left the shelf because it was sold: at the till, or delivered to customers." />

          <Head title="Sales and delivery breakdown" />
          {sold.map((r) => (
            <tr key={`s-${r.key}`} className="sf-l1" data-tone="sold"><td><span className="sf-label">{phrase(r, "sold")}<HelpHint label={r.label}>{r.detail}</HelpHint></span></td>
              <td className="sf-bar"><i style={{ width: `${cos > 0 ? (r.value / cos) * 100 : 0}%` }} /></td>
              <td className="sf-pct">{pct(r.value)}</td><td className="sf-amt">{money(r.value)}</td></tr>
          ))}

          {showCarriage && <>
            <Head title="Carriage inward & landed costs" />
            <tr className="sf-l1" data-tone="in"><td colSpan={3}><span className="sf-label">Allocated landed costs included in inventory cost
              <HelpHint label="Allocated landed costs">Freight, duty and courier charges spread onto the goods they brought. They are part of the inventory cost above, so they reach cost of sales as those goods sell.</HelpHint></span>
              <small className="sf-note">Already included above; shown for information</small></td>
              <td className="sf-amt">{d.landedIn ? money(d.landedIn) : "—"}</td></tr>
            <tr className="sf-l1" data-tone="other"><td colSpan={3}><span className="sf-label">Add: carriage inward recorded directly to expense{d.carriage ? ` · GL ${d.carriage.code}` : ""}
              <HelpHint label="Carriage inward to expense">Courier and freight bills booked to carriage inward and not spread onto any goods. They are a cost of getting stock in, so they sit with cost of sales.</HelpHint></span></td>
              <td className="sf-amt">{money(carriage)}</td></tr>
            <Band label="Cost of sales and deliveries including direct carriage" value={cos + carriage} tone="sold" />
          </>}

          <Head title="GL reconciliation" />
          <tr className="sf-l1" data-tone={glGap === 0 ? "sold" : "bad"}><td colSpan={3}><span className="sf-label">GL {d.cogsCode} · Inventory cost of sales
            <HelpHint label="Cost of sales in the ledger">Cost of sales above, less what came back to it in the period (customer returns, voided sales: {money(d.cogsCredits)}), less delivered goods not yet billed. That is what the ledger should show.</HelpHint></span>
            <small className="sf-note">{glGap === 0 ? `Agrees with the movements above · expected ${money(expectedGl)}` : `Differs by ${money(glGap)} from the ${money(expectedGl)} the movements predict — see the checks below`}</small></td>
            <td className="sf-amt">{money(d.cogsGl)}</td></tr>
          {/* Only when carriage was recorded in the period: an empty line would read as a figure missing. */}
          {d.carriage && carriage !== 0 && (
            <tr className="sf-l1" data-tone="other"><td colSpan={3}><span className="sf-label">GL {d.carriage.code} · Carriage inward expense
              <HelpHint label="Carriage inward in the ledger">Read straight from the account for the period; nothing to reconcile it against.</HelpHint></span>
              <small className="sf-note">Posted balance for the period</small></td>
              <td className="sf-amt">{money(carriage)}</td></tr>
          )}
        </tbody>
      </table>
      {d.heldClosing !== 0 && (
        <p className="sf-foot sf-warn">Delivered goods not yet invoiced wait in {d.heldCode}: {money(d.heldClosing)}. Their cost reaches cost of sales when they are billed — confirm before reporting final cost of sales.</p>
      )}
    </div>
  );
}
