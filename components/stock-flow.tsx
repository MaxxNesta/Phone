import { HelpHint } from "./help-hint";
import { money } from "@/lib/format";
import type { Reason } from "@/lib/stock-reasons";

/**
 * The stock movement for a period as a structured statement rather than a
 * list of sentences: what came in, what is left, and what left the shelf —
 * split into sold (cost of goods sold) and not sold — each reason indented
 * under its group, weighted by level, coloured by group, with its share of
 * what left and its explanation behind a "?". Used by the Inventory & cost of
 * sales report and the income statement's cost-of-sales panel.
 */
export function StockFlow({ opening, closing, additions, releases, movementsHref }: {
  opening: number; closing: number;
  additions: Reason[]; releases: Reason[];
  /** Where a reason row's "movements" link goes, if anywhere. */
  movementsHref?: string;
}) {
  const sum = (l: Reason[]) => l.reduce((t, x) => t + x.value, 0);
  const cameIn = sum(additions);
  const sold = releases.filter((r) => r.isCogs), notSold = releases.filter((r) => !r.isCogs);
  const left = sum(releases), soldTotal = sum(sold), notSoldTotal = sum(notSold);
  const pct = (v: number) => (left > 0 ? `${((v / left) * 100).toFixed(v / left < 0.01 ? 1 : 0)}%` : "");

  const Row = ({ r, level, tone }: { r: Reason; level: 1 | 2; tone: string }) => (
    <tr className={`sf-l${level}`} data-tone={tone}>
      <td>
        <span className="sf-label">
          {r.label}
          {r.attention && <span className="sf-tag">check</span>}
          <HelpHint label={r.label}>{r.detail}</HelpHint>
        </span>
      </td>
      <td className="sf-bar">{tone !== "in" && left > 0 && <i style={{ width: `${Math.min(100, (r.value / left) * 100)}%` }} />}</td>
      <td className="sf-pct">{tone !== "in" ? pct(r.value) : ""}</td>
      <td className="sf-amt">{money(r.value)}</td>
    </tr>
  );

  return (
    <div className="tablewrap">
      <table className="sf">
        <colgroup><col /><col className="sf-barcol" /><col className="sf-pctcol" /><col className="sf-amtcol" /></colgroup>
        <tbody>
          <tr className="sf-l0"><td>Opening inventory</td><td /><td /><td className="sf-amt">{money(opening)}</td></tr>

          <tr className="sf-g" data-tone="in"><td><span className="sf-dot" />Came in</td><td /><td /><td className="sf-amt">{money(cameIn)}</td></tr>
          {additions.map((r) => <Row key={`in-${r.key}`} r={r} level={1} tone="in" />)}

          <tr className="sf-l0"><td>Less closing inventory</td><td /><td /><td className="sf-amt sf-neg">({money(closing)})</td></tr>

          <tr className="sf-total"><td>Left the shelf</td><td /><td className="sf-pct">100%</td><td className="sf-amt">{money(left)}</td></tr>

          <tr className="sf-g" data-tone="sold">
            <td><span className="sf-dot" />Sold <span className="sf-sub">cost of goods sold</span></td>
            <td className="sf-bar"><i style={{ width: `${left > 0 ? (soldTotal / left) * 100 : 0}%` }} /></td>
            <td className="sf-pct">{pct(soldTotal)}</td><td className="sf-amt">{money(soldTotal)}</td>
          </tr>
          {sold.map((r) => <Row key={`s-${r.key}`} r={r} level={2} tone="sold" />)}

          {notSold.length > 0 && (
            <tr className="sf-g" data-tone="other">
              <td><span className="sf-dot" />Not sold <span className="sf-sub">not cost of goods sold</span></td>
              <td className="sf-bar"><i style={{ width: `${left > 0 ? (notSoldTotal / left) * 100 : 0}%` }} /></td>
              <td className="sf-pct">{pct(notSoldTotal)}</td><td className="sf-amt">{money(notSoldTotal)}</td>
            </tr>
          )}
          {notSold.map((r) => <Row key={`n-${r.key}`} r={r} level={2} tone="other" />)}
        </tbody>
      </table>
      {movementsHref && <p className="sf-foot"><a className="subline" href={movementsHref}>See the stock movements behind these figures →</a></p>}
    </div>
  );
}

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
