"use client";

import { useActionState } from "react";
import { saveCurrency, saveRate } from "@/lib/currency-actions";

export function CurrencyForm({ currency }: {
  currency?: { code: string; name: string; symbol: string | null; decimal_places: number };
}) {
  const [state, action, pending] = useActionState(saveCurrency, null);
  const k = currency?.code ?? "new";
  return (
    <form action={action} className="fx-form">
      {state && "error" in state && <div className="alert" role="alert">{state.error}</div>}
      {state && "ok" in state && <div className="alert ok" role="status">{state.ok}</div>}
      <div className="field">
        <label htmlFor={`cc-${k}`}>Code</label>
        <input id={`cc-${k}`} name="code" required maxLength={3} defaultValue={currency?.code}
          readOnly={Boolean(currency)} placeholder="USD" style={{ textTransform: "uppercase" }} />
      </div>
      <div className="field">
        <label htmlFor={`cn-${k}`}>Name</label>
        <input id={`cn-${k}`} name="name" required defaultValue={currency?.name} placeholder="US Dollar" />
      </div>
      <div className="field">
        <label htmlFor={`cs-${k}`}>Symbol</label>
        <input id={`cs-${k}`} name="symbol" defaultValue={currency?.symbol ?? ""} placeholder="$" />
      </div>
      <div className="field">
        <label htmlFor={`cd-${k}`}>Decimals</label>
        <input id={`cd-${k}`} name="decimal_places" type="number" min={0} max={4}
          defaultValue={currency?.decimal_places ?? 2} />
      </div>
      <button className="btn" disabled={pending}>{currency ? "Save" : "Add currency"}</button>
    </form>
  );
}

export function RateForm({ currencies, base, today }: { currencies: string[]; base: string; today: string }) {
  const [state, action, pending] = useActionState(saveRate, null);
  return (
    <form action={action} className="fx-form">
      {state && "error" in state && <div className="alert" role="alert">{state.error}</div>}
      {state && "ok" in state && <div className="alert ok" role="status">{state.ok}</div>}
      <div className="field">
        <label htmlFor="rf-cur">1 unit of</label>
        <select id="rf-cur" name="from_currency" defaultValue={currencies.includes("CNY") ? "CNY" : currencies[0]}>
          {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="rf-rate">costs ({base})</label>
        <input id="rf-rate" name="rate" type="number" step="any" min="0" required placeholder="450" />
      </div>
      <div className="field">
        <label htmlFor="rf-date">From</label>
        <input id="rf-date" name="valid_from" type="date" defaultValue={today} required />
      </div>
      <div className="field">
        <label htmlFor="rf-type">Type</label>
        <select id="rf-type" name="rate_type" defaultValue="MARKET">
          <option value="MARKET">Market</option>
          <option value="OFFICIAL">Central bank</option>
          <option value="CONTRACT">Contract</option>
        </select>
      </div>
      <button className="btn" disabled={pending}>Save rate</button>
    </form>
  );
}
