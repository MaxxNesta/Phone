"use client";

export type FxOption = { code: string; symbol: string | null; rate: number | null };

/**
 * Which currency a purchase is in, and its rate. Renders the two hidden-name
 * fields the actions read (`currency`, `exchange_rate`). Kyat shows nothing
 * else; a foreign currency asks for the rate, prefilled with the latest on
 * file, and says what it means in plain words.
 *
 * `locked` is for a document whose rate is decided elsewhere — a bill for
 * goods received in yuan is at the receipt's rate, whatever is typed.
 */
export function CurrencyRate({ options, base, currency, rate, onChange, locked }: {
  options: FxOption[];
  base: string;
  currency: string;
  rate: string;
  onChange: (currency: string, rate: string) => void;
  locked?: string | null;
}) {
  const foreign = currency && currency !== base;
  return (
    <>
      <input type="hidden" name="currency" value={foreign ? currency : ""} />
      <input type="hidden" name="exchange_rate" value={foreign ? rate : ""} />
      <div className="field">
        <label htmlFor="fx-currency">Currency</label>
        <select id="fx-currency" value={currency || base} disabled={Boolean(locked)}
          onChange={(e) => {
            const c = e.target.value;
            const known = options.find((o) => o.code === c)?.rate;
            onChange(c, c === base ? "" : known ? String(known) : "");
          }}>
          <option value={base}>{base}</option>
          {options.filter((o) => o.code !== base).map((o) => (
            <option key={o.code} value={o.code}>{o.code}{o.symbol ? ` (${o.symbol})` : ""}</option>
          ))}
        </select>
      </div>
      {foreign && (
        <div className="field">
          <label htmlFor="fx-rate">1 {currency} = {base}</label>
          <input id="fx-rate" type="number" step="any" min="0" required value={rate}
            readOnly={Boolean(locked)} onChange={(e) => onChange(currency, e.target.value)} />
          <span className="hint">
            {locked ?? (Number(rate) > 0
              ? `Prices below are in ${currency}; the books record them at ${Number(rate).toLocaleString("en-US")} ${base} each.`
              : `No ${currency} rate on file — type today's.`)}
          </span>
        </div>
      )}
    </>
  );
}

/** Kyat over a rate, for showing a stored kyat figure in its own currency. */
export const inFc = (base: number, rate: number | null | undefined) =>
  rate && rate !== 1 ? Math.round((base / rate) * 100) / 100 : base;
