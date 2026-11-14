/**
 * What each package allows.
 *
 * One place, so that when a limit is finally enforced there is a single
 * number to change rather than a condition written into whichever screen
 * happened to need it first.
 *
 * Branches and warehouses are enforced (2026-10-05) by
 * assertLocationAllowed in lib/actions.ts, on create, edit and reactivate.
 * Only Starter's limits are agreed; the rest are null, which means "not
 * decided" and never refuses — writing Infinity here would look like a
 * decision nobody made.
 *
 * Two rules matter more than the numbers:
 *
 * 1. **Existing data is grandfathered.** Both live databases already hold
 *    two branches. A company over its limit keeps what it has and is
 *    refused only when it tries to add more. Nothing already posted or
 *    configured should ever be invalidated by a change to a price list.
 *
 * 2. **Gate the navigation, not the ledger.** Hiding a module a customer
 *    has not bought is reasonable. Hiding accounts, or refusing to post to
 *    them, is not: the books are theirs whatever they paid, and a trial
 *    balance that omits rows because of a subscription is a wrong trial
 *    balance.
 */

export type Plan = "STARTER" | "BUSINESS" | "ENTERPRISE";

/**
 * The names customers see. The stored codes stay as they are (company.plan,
 * checked by migration 0100); only what the screen calls them changed
 * (2026-11-13): three packages, Essential, Standard and Advanced.
 */
export const PLAN_NAME: Record<Plan, string> = {
  STARTER: "Essential",
  BUSINESS: "Standard",
  ENTERPRISE: "Advanced",
};

export type PlanLimits = {
  /** Top-level locations — a branch is a location with no parent. */
  branches: number | null;
  /** Locations that hold stock — `is_stock_location`. */
  warehouses: number | null;
  /** People who can sign in. Meaningless until there is a sign-in. */
  users: number | null;
};

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  // Branches and warehouses are unlimited in every package (owner's call,
  // 2026-11-14); null never refuses. Each package includes one user, and
  // further users are bought as seats (0196).
  STARTER: { branches: null, warehouses: null, users: 1 },
  BUSINESS: { branches: null, warehouses: null, users: 1 },
  ENTERPRISE: { branches: null, warehouses: null, users: 1 },
};

/**
 * Whether the package can be changed from inside the app. Not in production:
 * there the customer's own admin would otherwise lift their own limits. The
 * vendor changes a live company's package in the database. Dev and preview
 * keep the switch so the tiers can be tested.
 */
export const planSwitchable = process.env.VERCEL_ENV !== "production";
// Customers never change it in production; on DEV and preview the owner can,
// to test each package (and scripts/set-package.mjs does the same from a terminal).

/**
 * Seats (0196, 0197). A package seat holds any role; a module seat, bought
 * with the Sales, Purchases or Inventory module, holds only that module's
 * roles. A package is always underneath: module seats are added to it.
 */
export type Seat = "package" | "sales" | "purchases" | "inventory";
export const SEATS: { key: Seat; name: string; roles: string[] | null }[] = [
  { key: "package", name: "Package seat", roles: null },
  { key: "sales", name: "Sales seat", roles: ["CASHIER", "SALESPERSON"] },
  { key: "purchases", name: "Purchases seat", roles: ["PURCHASER"] },
  { key: "inventory", name: "Inventory seat", roles: ["INVENTORY"] },
];
export const seatAllows = (seat: Seat, role: string) => {
  const s = SEATS.find((x) => x.key === seat);
  return !!s && (s.roles === null || s.roles.includes(role));
};

/** Package levels, lowest first. A seat's level never rises above the company's. */
export const PLAN_ORDER: Plan[] = ["STARTER", "BUSINESS", "ENTERPRISE"];
export const planRank = (p: Plan) => PLAN_ORDER.indexOf(p);
/** The lower of two levels: a seat is capped by the company's package. */
export const capPlan = (seat: Plan | null | undefined, company: Plan): Plan =>
  seat && planRank(seat) < planRank(company) ? seat : company;

/** Add-ons that need Standard or Advanced underneath (2026-11-14). */
export const STANDARD_UP_ADDONS: Module[] = ["fixed_assets", "landed_cost"];
export const addonAllowed = (plan: Plan, m: Module) => !STANDARD_UP_ADDONS.includes(m) || plan !== "STARTER";

/**
 * Package seats at one level: the company's own level brings its included
 * seat; every level has the extra seats bought at it (0198).
 */
export const packageSeatsAt = (level: Plan, companyPlan: Plan, bought: Record<string, number> | null | undefined) =>
  (level === companyPlan ? (limitFor(companyPlan, "users") ?? 0) : 0) + Math.max(0, Number(bought?.[level] ?? 0));

/** People who may sign in: the package's included user plus the seats bought (0196). */
export const userLimit = (plan: Plan, extraUsers: number) => (limitFor(plan, "users") ?? 0) + Math.max(0, extraUsers || 0);

/** Whether a limit is known. An unknown limit never refuses anything. */
export function limitFor(plan: Plan, what: keyof PlanLimits): number | null {
  return PLAN_LIMITS[plan]?.[what] ?? null;
}

/**
 * Features a package includes, as opposed to limits it imposes.
 *
 * Separate from PLAN_LIMITS because the two answer different questions —
 * "how many warehouses may they have" and "is this screen theirs" — and a
 * single table conflating them would make both harder to read.
 *
 * **This gates what is offered, not what is true.** A feature withheld here
 * is a screen the customer does not see; nothing in the ledger changes, and
 * no figure is hidden from a report they can already reach. That line comes
 * from the rule above: hiding a module nobody bought is reasonable, hiding
 * accounts is not.
 */
export type Feature = "supplier_performance" | "dashboard_advanced" | "replenishment"
  | "financial_ratios" | "price_history" | "supply_chain"
  | "inventory_aging" | "financial_statements" | "sales_report" | "ar_ap_aging" | "inventory_analysis";

const FEATURES: Record<Feature, Plan[]> = {
  // Business and Enterprise. A Starter shop buys from a handful of people
  // it already knows; scoring them is a growing company's problem.
  // Advanced only (2026-11-14). It scores suppliers on orders: promised
  // dates, what arrived against them, and price. Purchases billed directly,
  // without an order, have nothing to be measured against and are left out.
  supplier_performance: ["ENTERPRISE"],
  // The main dashboard's accounting health (trial balance checks) and its
  // region, customer-type and supplier-type breakdowns. Starter keeps the
  // rest of the dashboard (decided 2026-11-09).
  dashboard_advanced: ["BUSINESS", "ENTERPRISE"],
  // The planning workbench (Inventory → Replenishment): safety stock, ABC/XYZ,
  // the projection and bulk purchase orders. The top package only (owner's
  // call, 2026-11-11). Low-stock alerts and reorder points stay in every
  // package; only the screen that plans the buying is withheld.
  replenishment: ["ENTERPRISE"],

  // Advanced only (2026-11-13): the analysis screens.
  financial_ratios: ["ENTERPRISE"],
  price_history: ["ENTERPRISE"],
  supply_chain: ["ENTERPRISE"],

  // Standard and Advanced (2026-11-13): the detailed reports Essential does
  // without. Essential keeps the summaries — sales overview, the inventory
  // summary, receivables and payables — and the ledger itself.
  inventory_aging: ["BUSINESS", "ENTERPRISE"],
  financial_statements: ["BUSINESS", "ENTERPRISE"],
  sales_report: ["BUSINESS", "ENTERPRISE"],
  ar_ap_aging: ["BUSINESS", "ENTERPRISE"],
  // Inventory turnover, days inventory outstanding and stock cover (2026-11-14).
  inventory_analysis: ["BUSINESS", "ENTERPRISE"],
};

/**
 * The areas a company can buy separately (migration 0194), on top of its
 * package. Dashboard, products, partners, documents and settings come with
 * every purchase. Counter Sale is part of Sales.
 */
export type Module = "sales" | "purchases" | "inventory" | "landed_cost" | "accounting" | "fixed_assets" | "hr" | "equity" | "logistics";

/**
 * Every package includes the core: selling, buying, stock and the books.
 * The package decides how deep each goes. The rest are add-ons, bought on
 * top of any package (a company always has one: company.plan is not null).
 */
export const CORE_MODULES: Module[] = ["sales", "purchases", "inventory", "accounting"];
export const isCore = (m: Module) => CORE_MODULES.includes(m);

export const MODULES: { key: Module; name: string; covers: string }[] = [
  { key: "sales", name: "Sales", covers: "Counter sale, sales history, invoices, returns, receivables" },
  { key: "purchases", name: "Purchases", covers: "Orders, goods receipts, purchase invoices, payables" },
  { key: "inventory", name: "Inventory", covers: "Stock, IMEI tracking, transfers, counts, aging" },
  { key: "landed_cost", name: "Landed cost", covers: "Freight, duty and carriage onto stock; the carriage section on receipts and bills" },
  { key: "accounting", name: "Accounting", covers: "Cash and bank, journals, ledger, financial reports" },
  { key: "fixed_assets", name: "Fixed Assets", covers: "Asset register, depreciation" },
  { key: "hr", name: "HR & Payroll", covers: "Employees, advances, payroll, payslips" },
  { key: "equity", name: "Equity", covers: "Shareholders, capital, share transfers" },
  { key: "logistics", name: "Logistics", covers: "Routes, delivery trips, vehicles, drivers" },
];

/**
 * Whether the company has a module: the core comes with every package; an
 * add-on only when bought. A company read without the column (older code
 * paths) has them all.
 */
export function hasModule(company: { modules?: string[] | null; plan?: Plan } | null | undefined, m: Module): boolean {
  if (isCore(m)) return true;
  if (company?.plan && !addonAllowed(company.plan, m)) return false;
  return !company?.modules || company.modules.includes(m);
}

/**
 * The package page's comparison, in the order it is read. `in` lists the
 * packages that include the line; a line every package has is still listed,
 * so the columns show what Essential gives as well as what it lacks.
 */
export const PLAN_COMPARISON: { group: string; lines: { label: string; note?: string; in: Plan[] }[] }[] = [
  { group: "Everyday", lines: [
    { label: "Counter sale, invoices, returns", in: ["STARTER", "BUSINESS", "ENTERPRISE"] },
    { label: "Purchases, goods receipts, payables", in: ["STARTER", "BUSINESS", "ENTERPRISE"] },
    { label: "Stock, IMEI tracking, transfers, counts", in: ["STARTER", "BUSINESS", "ENTERPRISE"] },
    { label: "Low-stock alerts and reorder points", in: ["STARTER", "BUSINESS", "ENTERPRISE"] },
    { label: "Cash and bank vouchers, journals", in: ["STARTER", "BUSINESS", "ENTERPRISE"] },
    { label: "General ledger and trial balance", in: ["STARTER", "BUSINESS", "ENTERPRISE"] },
    { label: "Sales overview and sales & margin", in: ["STARTER", "BUSINESS", "ENTERPRISE"] },
  ] },
  { group: "Reports", lines: [
    { label: "Financial statements (P&L, balance sheet, cash flow, inventory & COGS)", in: FEATURES.financial_statements },
    { label: "Detailed sales report", in: FEATURES.sales_report },
    { label: "AR / AP aging", in: FEATURES.ar_ap_aging },
    { label: "Inventory aging", in: FEATURES.inventory_aging },
    { label: "Inventory turnover, days of stock and stock cover", in: FEATURES.inventory_analysis },
    { label: "Dashboard accounting health and breakdowns", in: FEATURES.dashboard_advanced },
  ] },
  { group: "Advanced", lines: [
    { label: "Replenishment planning", in: FEATURES.replenishment },
    { label: "Financial ratios", in: FEATURES.financial_ratios },
    { label: "Price history", in: FEATURES.price_history },
    { label: "Supply chain", in: FEATURES.supply_chain },
    { label: "Supplier performance", note: "Scores purchases made through purchase orders only; bills entered directly without an order are not counted", in: FEATURES.supplier_performance },
  ] },
];

/** Where a low-stock link should lead: the planner where the package has it, the Stock page otherwise. */
export function lowStockHref(plan: Plan): string {
  return planIncludes(plan, "replenishment") ? "/inventory/replenishment" : "/items/stock";
}

export function planIncludes(plan: Plan, feature: Feature): boolean {
  return FEATURES[feature].includes(plan);
}

/**
 * **Not security.** There is no authentication in this application — no
 * users, no sessions, no identity to check a permission against. Anyone who
 * can reach the server can reach any route on it, and calling this in a
 * page prevents an upsell being given away, not an intruder getting in.
 *
 * It is written as a function rather than inlined so that the day sign-in
 * arrives there is one place to put the real check, and so that a search
 * for the feature finds every screen that offers it.
 */
export function requireFeature(plan: Plan, feature: Feature): boolean {
  return planIncludes(plan, feature);
}
