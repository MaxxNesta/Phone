import type { Parcel } from "./cod";
import { money } from "./format";

export function collectionBalance(p: Parcel) {
  return Math.max(0, p.due - p.availableDeposit);
}

export function carrierInstruction(p: Parcel) {
  switch (p.state) {
    case "RETURNED": return "Returned to shop";
    case "REFUSED": return "Return to shop";
    case "HANDED_OVER": return "Already handed over";
  }
  if (p.sharedAmount) return "Split delivery · confirm balance with shop";
  const due = collectionBalance(p);
  return due > 0 ? `Collect ${money(due)} MMK` : "Covered by deposit · confirm handover";
}

/** Deposits and first-handover charges belong to an invoice, even in a courier batch. */
export function batchCollection(rows: Pick<Parcel, "invoiceId" | "goods" | "extras" | "availableDeposit">[]) {
  const balances = new Map<string, number>();
  for (const p of rows) {
    const base = balances.get(p.invoiceId) ?? p.extras - p.availableDeposit;
    balances.set(p.invoiceId, base + p.goods);
  }
  return [...balances.values()].reduce((total, balance) => total + Math.max(0, balance), 0);
}
