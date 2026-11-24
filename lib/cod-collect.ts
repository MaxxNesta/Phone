/**
 * What to collect at the door for a COD parcel (0233). Pure, so the screens
 * that run in the browser can use it too.
 */

import type { Parcel } from "./cod";

const round4 = (n: number) => Math.round(n * 10000) / 10000;

/* The deposit and the charge belong to the invoice and land on whichever
   parcel is handed over first (confirmHandover). So a parcel handed over now
   takes all of both; one handed over after every other open parcel takes
   only what deposit is left over. */
export function collect(goods: number, extras: number, deposit: number, othersGoods: number) {
  return {
    goods: round4(goods), extras: round4(extras), deposit: round4(deposit), othersGoods: round4(othersGoods),
    collectNow: round4(Math.max(0, goods + extras - deposit)),
    collectLast: round4(Math.max(0, goods - Math.max(0, deposit - othersGoods - extras))),
  };
}

const mmk = (n: number) => `${n.toLocaleString("en-US", { maximumFractionDigits: 0 })} MMK`;

/** What the driver or courier is told for this parcel, in words. */
export function collectText(p: Parcel) {
  switch (p.state) {
    case "REFUSED": return "Return to shop · collect nothing";
    case "RETURNED": return "Back in stock";
    case "HANDED_OVER": return "Handed over";
  }
  if (p.othersGoods > 0 && Math.abs(p.collectNow - p.collectLast) > 0.005) {
    // The deposit and charge come off whichever parcel is handed over first.
    const who = p.others.length ? `${p.others.join(" or ")} goes` : "another parcel goes";
    return `Collect ${mmk(p.collectNow)} (${mmk(p.collectLast)} if ${who} first)`;
  }
  return p.collectNow > 0 ? `Collect ${mmk(p.collectNow)}` : "Paid by deposit · collect nothing";
}

/** Cash to come in for a set of open parcels: each invoice's deposit and charge counted once. */
export function collectTotal(parcels: Pick<Parcel, "invoiceId" | "goods" | "extras" | "deposit">[]) {
  const by = new Map<string, number>();
  for (const p of parcels) by.set(p.invoiceId, (by.get(p.invoiceId) ?? p.extras - p.deposit) + p.goods);
  return round4([...by.values()].reduce((t, v) => t + Math.max(0, v), 0));
}

