"use client";

import { useState } from "react";
import Link from "next/link";
import { saveRate } from "@/lib/currency-actions";

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
export function CurrencyRate({ options, base, currency, rate, onChange, locked, date, pricesIn }: {
  options: FxOption[];
  base: string;
  currency: string;
  rate: string;
  onChange: (currency: string, rate: string) => void;
  locked?: string | null;
  /** The document's date: a rate saved from here applies from it. */
  date?: string;
  /** The currency the line prices are really in, when it is not `currency`
   *  yet because no rate was known to convert them. */
  pricesIn?: string;
}) {
  const foreign = currency && currency !== base;
  const onFile = options.find((o) => o.code === currency)?.rate ?? null;
  const [saved, setSaved] = useState<string | null>(null);
  const saveIt = async () => {
    const fd = new FormData();
    fd.set("from_currency", currency); fd.set("rate", rate);
    fd.set("valid_from", date || new Date().toISOString().slice(0, 10));
    const r = await saveRate(null as never, fd);
    setSaved(r && "ok" in r ? `Saved: ${r.ok}` : (r as { error?: string })?.error ?? "Not saved");
  };
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
            {locked ?? (pricesIn && pricesIn !== currency
              ? `Prices are still in ${pricesIn}. Type the ${currency} rate and they convert.`
              : Number(rate) > 0
              ? `Prices below are in ${currency}; the books record them at ${Number(rate).toLocaleString("en-US")} ${base} each.`
              : `No ${currency} rate on file — type today's.`)}
            {!locked && (
              <span style={{ display: "block", marginTop: 2 }}>
                {Number(rate) > 0 && Number(rate) !== onFile && (
                  <><button type="button" className="linkish" onClick={saveIt}>Save as the {currency} rate</button>{" · "}</>
                )}
                <Link href="/settings/currencies" target="_blank" className="linkish">Currencies &amp; rates</Link>
                {saved && <span style={{ display: "block" }}>{saved}</span>}
              </span>
            )}
          </span>
        </div>
      )}
    </>
  );
}

/**
 * Line prices follow the currency. Switching from kyat to yuan at 450
 * turns 4,500,000 into 10,000 rather than relabelling it, and back again.
 * With no rate on either side there is nothing to convert by, so the
 * prices stay in the currency they were typed in (`pricesIn`) until one is
 * entered — then they convert.
 */
export function useFxSwitch(base: string, currency: string, rate: string,
  set: (currency: string, rate: string) => void, convert: (factor: number) => void) {
  const rateOf = (c: string, r: string) => (c === base ? 1 : Number(r) || 0);
  const [pricedIn, setPricedIn] = useState({ c: currency, r: rateOf(currency, rate) });
  const change = (c: string, r: string) => {
    const to = rateOf(c, r);
    if (c !== pricedIn.c && pricedIn.r > 0) {
      if (to > 0) { convert(pricedIn.r / to); setPricedIn({ c, r: to }); }
    } else {
      setPricedIn({ c, r: to });
    }
    set(c, r);
  };
  /** The prices already are in this currency: take it without converting. */
  const reset = (c: string, r: string) => { setPricedIn({ c, r: rateOf(c, r) }); set(c, r); };
  return { change, reset, pricesIn: pricedIn.c };
}

/** A price times a factor, to the cent. Blank stays blank. */
export const convertPrice = (v: string, f: number) =>
  v === "" || !Number.isFinite(Number(v)) ? v : String(Math.round(Number(v) * f * 100) / 100);

/** Kyat over a rate, for showing a stored kyat figure in its own currency. */
export const inFc = (base: number, rate: number | null | undefined) =>
  rate && rate !== 1 ? Math.round((base / rate) * 100) / 100 : base;
