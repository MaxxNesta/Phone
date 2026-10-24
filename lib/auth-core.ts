import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { sql } from "./db";

// Roles, permissions, passwords and session lookup (migration 0118).
// No Next.js imports, so middleware can use it; lib/auth.ts adds cookies.
//
// The role → permission map lives here, in code, because every permission is
// checked by code. Server-side is the only check that counts: middleware gates
// pages by path, every server action calls requirePermission first, and the
// navigation hiding things is a courtesy on top.

import { ROLES, ROLE_LABEL, type Role } from "./roles";
export { ROLES, ROLE_LABEL, type Role };

export type Permission =
  | "pos.sell"            // ring up a counter sale, take payment
  | "sales.view"
  | "sales.post"          // invoices, receipts from customers
  | "sales.return"        // customer returns, credit notes
  | "documents.void"      // void and correct posted documents
  | "discount.unlimited"  // above the role's discount ceiling
  | "cost.view"           // cost, margin, inventory value
  | "purchase.view"
  | "purchase.post"
  | "inventory.view"
  | "inventory.manage"    // receive, transfer, adjust, holds
  | "partners.manage"
  | "items.manage"
  | "brands.manage"       // add a brand: owner only, the shop sells Apple
  | "items.duplicates"    // keep two variants of one configuration on purpose
  | "accounting.view"
  | "accounting.post"
  | "reports.view"
  | "settings.manage"
  | "receipts.manage"     // receipt templates: admins all; managers their own branch's
  | "users.manage";

const ALL: Permission[] = [
  "pos.sell", "sales.view", "sales.post", "sales.return", "documents.void",
  "discount.unlimited", "cost.view", "purchase.view", "purchase.post",
  "inventory.view", "inventory.manage", "partners.manage", "items.manage", "brands.manage", "items.duplicates",
  "accounting.view", "accounting.post", "reports.view", "settings.manage", "users.manage",
  "receipts.manage",
];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  ADMIN: ALL,
  MANAGER: ALL.filter((p) => p !== "users.manage" && p !== "settings.manage"),
  CASHIER: ["pos.sell", "sales.view", "sales.post", "inventory.view", "partners.manage"],
  SALESPERSON: ["pos.sell", "sales.view", "inventory.view", "partners.manage"],
  INVENTORY: ["inventory.view", "inventory.manage", "purchase.view", "items.manage"],
  ACCOUNTANT: ["sales.view", "purchase.view", "inventory.view", "cost.view",
    "accounting.view", "accounting.post", "reports.view", "partners.manage"],
};

/** The largest line discount a role may give without discount.unlimited. */
export const DISCOUNT_CEILING_PCT = 5;

export type SessionUser = {
  id: string; companyId: string; name: string; initials: string;
  email: string; role: Role;
  /** The branch this person works at; null for every branch (admin/manager only). */
  branchId: string | null;
  /** May see every branch's documents and reports, though posting stays at branchId. */
  seesAllBranches: boolean;
};

/** Only these roles may work across every branch. */
export const ALL_BRANCH_ROLES: Role[] = ["ADMIN", "MANAGER"];

export function can(user: Pick<SessionUser, "role"> | null | undefined, p: Permission) {
  return Boolean(user && ROLE_PERMISSIONS[user.role]?.includes(p));
}

// ------------------------------------------------------------ passwords --

export function hashPassword(password: string): string {
  if (password.length < 8) throw new Error("A password needs at least 8 characters");
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored) return false;
  const [scheme, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = scryptSync(password, Buffer.from(saltB64, "base64"), expected.length);
  return timingSafeEqual(actual, expected);
}

export const SESSION_COOKIE = "erp_session";

export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

/** The user a session token belongs to, if it is live. Shared with middleware. */
export async function userForToken(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const [u] = await sql`
    select u.id, u.company_id, u.name, u.initials, u.email, u.role, u.branch_id, u.sees_all_branches
      from user_session s join app_user u on u.id = s.user_id
     where s.token_hash = ${tokenHash(token)} and s.expires_at > now() and u.is_active`;
  if (!u) return null;
  return { id: u.id, companyId: u.company_id, name: u.name, initials: u.initials,
           email: u.email, role: u.role as Role, branchId: u.branch_id ?? null,
           seesAllBranches: Boolean(u.sees_all_branches) };
}

/**
 * Whether anyone has to sign in. Off unless AUTH_REQUIRED=true: a single shop
 * where everyone is trusted runs without logins, and every request acts as
 * the owner. Turning it on brings back sign-in, roles and the per-role checks
 * unchanged — nothing below needs to know which mode it is in.
 */
export const authRequired = () => process.env.AUTH_REQUIRED === "true";

/**
 * The owner, for when sign-in is off: an administrator row in app_user,
 * made the first time it is needed, so documents still say who posted them.
 *
 * Read first: the row exists on every request but the first, so the upsert —
 * a write, and an extra round trip — runs only when the row is missing or no
 * longer an active administrator, which is exactly when it changes anything.
 */
export async function ownerUser(): Promise<SessionUser | null> {
  const toUser = (u: Record<string, any>): SessionUser => ({
    id: u.id, companyId: u.company_id, name: u.name, initials: u.initials,
    // With sign-in off there is one person, the owner, and the owner works everywhere.
    email: u.email ?? "", role: u.role as Role, branchId: null, seesAllBranches: true });
  // The company is found inside the same statement, with no parameters: one
  // round trip, and it need not wait for the layout's own company lookup.
  const [found] = await sql`
    select u.id, u.company_id, u.name, u.initials, u.email, u.role, u.is_active
      from app_user u
     where u.name = 'Owner'
       and u.company_id = (select id from company order by created_at limit 1)`;
  if (found && found.role === "ADMIN" && found.is_active) return toUser(found);
  const [co] = await sql`select id from company order by created_at limit 1`;
  if (!co) return null;
  const coId = co.id;
  const [u] = await sql`
    insert into app_user (company_id, name, initials, role)
    values (${coId}, 'Owner', 'OW', 'ADMIN')
    on conflict (company_id, name) do update set role = 'ADMIN', is_active = true
    returning id, company_id, name, initials, email, role`;
  return toUser(u);
}

// ------------------------------------------------------- page gating ----
//
// First match wins, so narrower prefixes come first. A path not listed needs
// only a signed-in user.

export const PATH_PERMISSIONS: Array<[string, Permission]> = [
  ["/settings/users", "users.manage"],
  ["/settings/receipt-templates", "receipts.manage"],
  // Rates are kept by whoever buys stock; the page itself refuses edits to
  // the currency list to anyone but an administrator.
  ["/settings/currencies", "purchase.view"],
  ["/settings", "settings.manage"],
  ["/finance", "accounting.view"],
  ["/ledger", "accounting.view"],
  ["/payables", "accounting.view"],
  ["/reports", "reports.view"],
  ["/sales/reports", "reports.view"],
  ["/sales", "sales.view"],
  ["/receivables", "sales.view"],
  ["/pos", "pos.sell"],
  // A landed cost shows and changes what stock cost, so cost visibility,
  // not purchasing, is what opens it.
  ["/purchases/landed-costs", "cost.view"],
  ["/purchases", "purchase.view"],
  ["/inventory", "inventory.view"],
  ["/warehouses", "inventory.view"],
  ["/items", "inventory.view"],
  ["/products", "items.manage"],
  ["/logistics", "settings.manage"],
];

/**
 * What it takes to open a document, by its type.
 *
 * /documents/<id> sits under no listed prefix, so the path check let any
 * signed-in user open any document — a cashier could read a goods receipt
 * and the cost of every phone on it. A document is the side of the business
 * it belongs to: a purchase needs purchase.view, a voucher accounting.view.
 * An unknown type needs the most, not the least.
 */
const DOCUMENT_PERMISSIONS: Record<string, Permission> = {
  SALES_ORDER: "sales.view", SALES_INVOICE: "sales.view", SALES_RETURN: "sales.view",
  CUSTOMER_RECEIPT: "sales.view", CUSTOMER_REFUND: "sales.view", CREDIT_NOTE: "sales.view",
  PURCHASE_ORDER: "purchase.view", GOODS_RECEIPT: "purchase.view", PURCHASE_INVOICE: "purchase.view",
  PURCHASE_RETURN: "purchase.view", SUPPLIER_PAYMENT: "purchase.view", DEBIT_NOTE: "purchase.view",
  CONSIGNMENT_RECEIPT: "purchase.view", LANDED_COST: "cost.view",
  DELIVERY: "inventory.view", STOCK_TRANSFER: "inventory.view", STOCK_ADJUSTMENT: "inventory.view",
};

export function permissionForDocument(docType: string): Permission {
  return DOCUMENT_PERMISSIONS[docType] ?? "accounting.view";
}

export function permissionForPath(path: string): Permission | null {
  for (const [prefix, p] of PATH_PERMISSIONS) {
    if (path === prefix || path.startsWith(prefix + "/")) return p;
  }
  return null;
}
