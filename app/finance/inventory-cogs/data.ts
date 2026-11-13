import { todayLocal } from "@/lib/format";
import { scopedBranch, seenBranches } from "@/lib/branch-scope";
import {
  getCompany, getBranches, getUnassignedBranchActivity,
  getInventoryCogsReconciliation, UNASSIGNED_BRANCH,
} from "@/lib/queries";
import { stockReasons, explainGap, type Reason } from "@/lib/stock-reasons";

export type Params = { from?: string; to?: string; branch?: string };

const defaultFrom = () => `${new Date().getFullYear()}-01-01`;
const today = () => todayLocal();
const n = (v: unknown) => Number(v ?? 0);
const r4 = (v: number) => Math.round(v * 10000) / 10000;

/** A movement of stock, named by why it happened. */
export type Release = Reason;

export async function getInventoryCogsData({ from, to, branch }: Params) {
  const company = await getCompany();
  if (!company) return null;

  const range = { from: from || defaultFrom(), to: to || today() };

  const branches = (await seenBranches((await getBranches(company.id)) as unknown as { id: string }[])) as unknown as Array<{
    id: string; code: string; name: string; warehouse_count: number;
  }>;
  const unassignedLines = await getUnassignedBranchActivity(company.id);
  // Someone who sees only their own branch gets it, whatever the link asks for.
  const branchId = await scopedBranch(
    branch === UNASSIGNED_BRANCH ? UNASSIGNED_BRANCH
    : branch && branches.some((b) => b.id === branch) ? branch
    : null);
  const branchName =
    branchId === UNASSIGNED_BRANCH ? "No branch"
    : branches.find((b) => b.id === branchId)?.name ?? "All branches";

  const recon = await getInventoryCogsReconciliation(
    company.id, range.from, range.to, branchId);
  if (!recon) {
    return {
      company, branches, unassignedLines, branchId, branchName, range,
      missing: true as const,
    };
  }

  const opening = n(recon.bal.opening);
  const closing = n(recon.bal.closing);

  /* Every movement named by why it happened — a voided receipt, a customer
     return, a counter sale — rather than by the account on the other side,
     which told a reader nothing they could act on (lib/stock-reasons). */
  const roles = { cogsId: recon.cogsId, heldId: recon.heldId };
  const { additions, releases } = stockReasons(recon.movement, roles);

  const addedTotal = r4(additions.reduce((s, a) => s + a.value, 0));
  const releasedTotal = r4(releases.reduce((s, a) => s + a.value, 0));
  const soldCost = r4(releases.filter((x) => x.isCogs).reduce((s, x) => s + x.value, 0));
  const notSold = r4(releasedTotal - soldCost);

  /* The identity the tester checks the books with. It holds — and what it
     equals is everything that left the shelf, not cost of sales, whenever
     stock left for a reason that was not a sale. */
  const formula = r4(opening + addedTotal - closing);
  const formulaTies = formula === releasedTotal;

  /* Two checks that owe each other nothing: the stock ledger's own valuation
     against the account, and the cost it recorded against the cost posted. */
  const fifoValue = r4(n(recon.fifo.value) - n(recon.negative.value));
  const fifoGap = r4(fifoValue - closing);

  /* Stock no longer becomes cost of sales in one move. It leaves inventory
     for 1090 when the goods go, and reaches 5000 when the invoice bills
     them, so there are three accounts and two steps to check rather than
     two accounts and one. */
  const shippedCost = r4(
    recon.consumption
      .filter((c) => c.account_id != null && c.account_id === recon.cogsId && c.doc_type === "DELIVERY")
      .reduce((s, c) => s + n(c.value), 0));

  const held = recon.held;
  const heldIn = r4(n(held?.shipped_in));
  const heldOut = r4(n(held?.invoiced_out));
  const heldClosing = r4(n(held?.closing));
  const heldUnclaimed = r4(n(held?.unclaimed));
  /* What the account holds against what the claims say is unclaimed. The
     two are the same fact counted from opposite ends — the ledger and the
     allocation rows — so a gap means cost reached 1090 by a route nothing
     claimed, or a claim exists for cost that never arrived. */
  const heldGap = r4(heldClosing - heldUnclaimed);
  /* Goods shipped in the period against what the holding account received.
     Both are the delivery's own doing, so they tie unless a delivery moved
     stock without posting, or posted without moving it. */
  const shippedGap = r4(shippedCost - heldIn);

  /* What the claims released, against what cost of sales actually received
     from selling. A customer return credits 5000 as well and is not a claim
     being undone, so it is left out of the right-hand side rather than
     quietly spoiling the comparison. */
  const postedCogs = r4(n(recon.held?.cogs_from_sales));
  const calculatedCogs = heldOut;
  const cogsGap = r4(calculatedCogs - postedCogs);

  /* Why a check disagrees, as far as the movements can say. Each list names
     the items that account for the gap and leaves the rest as "not explained",
     so a reader sees what to look at rather than a red number. */
  const mv = recon.movement;
  type Mv = (typeof mv)[number];
  const moved = (pred: (m: Mv) => boolean, dir: "in" | "out") =>
    r4(mv.filter(pred).reduce((t, m) => t + n(dir === "in" ? m.into_stock : m.out_of_stock), 0));
  const manual = (m: Mv) => ["JOURNAL_VOUCHER", "CASH_VOUCHER", "BANK_VOUCHER"].includes(m.source_type);
  const manualNet = r4(moved(manual, "in") - moved(manual, "out"));
  // Stock drawn by deliveries that were later undone (on their own, or with the sale they were made for).
  const voidedDeliveries = r4(recon.consumption
    .filter((c) => c.doc_type === "DELIVERY" && c.reversed && c.account_id === recon.cogsId)
    .reduce((t, c) => t + n(c.value), 0));
  const why = {
    fifo: explainGap(fifoGap, [
      { label: "Manual journal entries to the inventory account", value: -manualNet,
        detail: "They change the account but move no stock. Reverse them, or post the stock movement they stand for." },
    ]),
    shipped: explainGap(shippedGap, [
      { label: "Deliveries since voided", value: voidedDeliveries,
        detail: "A delivery undone (on its own, or with the sale it was made for) keeps its use of stock on record while its holding-account entry is reversed. Nothing to fix." },
    ]),
    held: explainGap(heldGap, []),
    cogs: explainGap(cogsGap, []),
  };
  // The reasons stock left that are not cost of sales, for the headline tile.
  const otherReasons = releases.filter((x) => !x.isCogs);

  return {
    company, branches, unassignedLines, branchId, branchName, range,
    missing: false as const, why, otherReasons,
    // Carriage inward: what was spread onto the goods (already in inventory
    // above) and what is still sitting in expense for the period.
    landedIn: r4(additions.filter((a) => a.key === "landed").reduce((t, a) => t + a.value, 0)),
    carriage: recon.carriage ? { code: recon.carriage.code, name: recon.carriage.name, net: r4(n(recon.carriage.net)) } : null,
    // Cost of sales as the general ledger has it, for the reconciliation line.
    cogsGl: r4(n(recon.postedCogs?.value)),
    // Credits to cost of sales in the period: customer returns and voided sales.
    cogsCredits: r4(n(recon.returnedToCogs?.value)),
    opening, closing, additions, releases,
    addedTotal, releasedTotal, soldCost, notSold, formula, formulaTies,
    fifoValue, fifoGap, lots: recon.fifo.lots,
    negativeValue: r4(n(recon.negative.value)), negativeQty: r4(n(recon.negative.qty)),
    calculatedCogs, postedCogs, cogsGap,
    shippedCost, heldIn, heldOut, heldClosing, heldUnclaimed, heldGap, shippedGap,
    heldCode: recon.heldCode, cogsCode: recon.cogsCode,
  };
}
