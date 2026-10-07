import type { Metadata } from "next";
import { Noto_Sans_Myanmar, Inter } from "next/font/google";
import "./globals.css";
import Link from "next/link";
import { getCompany } from "@/lib/queries";
import { planIncludes } from "@/lib/plans";
import { NavLink, NavGroup, NavSubGroup } from "./nav";
import { MobileNav } from "@/components/mobile-nav";
import { SidebarCollapse } from "@/components/sidebar-collapse";
import { Toast } from "@/components/toast";
import {
  LayoutDashboard, ShoppingCart, Package, BookOpen, Boxes, Truck, ScanLine, Users, BarChart3, Settings,
  Smartphone, FileText, Search,
} from "lucide-react";
import { headers } from "next/headers";
import { currentUser, can, ROLE_LABEL, authRequired, type Permission } from "@/lib/auth";
import { signOut } from "@/lib/auth-actions";
import { DatePickerFix } from "@/components/date-picker-fix";

// One face for the whole product, chosen for the thing an ERP does most:
// show a column of numbers.
//
// The house face was DM Sans, which was right for the dashboard's headline
// figures and wrong for everything under them — it ships no tabular
// numerals at all. Measured at 16px its digits run from 5.00px for "1" to
// 10.95px for "0", and font-variant-numeric: tabular-nums does nothing
// because the feature is not in the font. A column of amounts set in it
// cannot line up, whatever CSS asks for.
//
// Inter has them, and switches on with tabular-nums (measured: digit width
// spread 0.000). It was drawn for user interfaces at small sizes, which is
// what a forty-row ledger is. Plex Sans would have been free — it is
// already loaded and its figures are uniform by default — but it reads as a
// different product, and the point here was to keep one look.
//
// Myanmar still falls through to Noto: Inter has no Burmese glyphs, and a
// name in Burmese must not silently lose its shapes to a fallback.
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-ui",
  display: "swap",
});

// Inter carries no Myanmar glyphs, so every name_my field would fall through
// to whatever the OS happened to ship — Myanmar Text on Windows, Myanmar
// Sangam MN on macOS, something else on a phone. Different machine, different
// rendering, and none of them matched the Latin face's weight or x-height. Loading this
// explicitly is what makes Burmese look deliberate rather than accidental.
const notoMyanmar = Noto_Sans_Myanmar({
  subsets: ["myanmar"],
  weight: ["400", "500", "600"],
  variable: "--font-myanmar",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Phone Retail ERP",
  description: "Point of sale, IMEI stock and accounting for phone shops",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let company: Awaited<ReturnType<typeof getCompany>> = null;
  let dbError: string | null = null;

  // Sign-in and first-run screens draw without the application around them.
  const path = (await headers()).get("x-pathname") ?? "";
  const bare = path === "/login" || path.startsWith("/setup");

  // Asked together: the user lookup shares the request's cached company, so
  // neither waits on the other beyond that one query.
  const [companyResult, userResult] = await Promise.allSettled([
    getCompany(),
    bare ? Promise.resolve(null) : currentUser(),
  ]);
  if (companyResult.status === "fulfilled") company = companyResult.value;
  else dbError = companyResult.reason instanceof Error ? companyResult.reason.message : String(companyResult.reason);
  const user = bare || dbError || userResult.status === "rejected" ? null : userResult.value;
  const may = (p: Permission) => can(user, p);
  // Distribution screens (orders, deliveries, routes) only in the trading flow.
  const wholesale = company ? !company.retail_mode : false;

  if (bare) {
    return (
      <html lang="en" className={`${inter.variable} ${notoMyanmar.variable}`}>
        <body><main className="bare">{children}</main><Toast /></body>
      </html>
    );
  }

  return (
    <html lang="en" className={`${inter.variable} ${notoMyanmar.variable}`}>
      <body>
        {/* Before first paint, so a rail somebody collapsed yesterday does not
            flash open and shove the page sideways on the way in. The effect in
            SidebarCollapse runs after paint, which is too late to prevent that
            — this is the same reason a theme preference is read here. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{if(localStorage.getItem('navCollapsed')==='true')"
              + "document.body.dataset.navCollapsed='true'}catch(e){}",
          }}
        />
        <DatePickerFix />
        <div className="shell">
          <MobileNav
            title={company?.name ?? "Myanmar ERP"}
            subtitle={company?.base_currency ?? "not set up"}
          />
          <nav className="sidebar" id="sidebar">
            <div className="brand">
              <span className="brand-name">{company?.name ?? "Myanmar ERP"}</span>
              <span className="brand-sub">{company?.base_currency ?? "not set up"}</span>
            </div>

            <SidebarCollapse />

            <NavLink href="/" exact><LayoutDashboard size={15} /> <span className="navlink-text">Dashboard</span></NavLink>

            {may("pos.sell") && <NavLink href="/pos"><ScanLine size={15} /> <span className="navlink-text">POS / Sales</span></NavLink>}

            {may("sales.view") && (
              <NavGroup label="Sales History" icon={<ShoppingCart size={15} />} match={["/sales", "/receivables"]}>
                <NavLink href="/sales/invoices" exact>Sales invoices</NavLink>
                {wholesale && <NavLink href="/sales/orders" exact>Sales orders</NavLink>}
                {wholesale && <NavLink href="/sales/deliver">Deliveries</NavLink>}
                {wholesale && <NavLink href="/sales/consignment">Consignment sale</NavLink>}
                <NavLink href="/sales/returns" exact>Customer returns</NavLink>
                <NavLink href="/sales/credit-notes" exact>Credit notes</NavLink>
                {wholesale && <NavLink href="/sales/discounts" exact>Volume discounts</NavLink>}
                <NavLink href="/sales/discounts-given" exact>Discounts given</NavLink>
                <NavLink href="/receivables" exact>Receivables</NavLink>
                <NavLink href="/receivables/advances">Customer advances</NavLink>
                <NavLink href="/receivables/receive">Receive payment</NavLink>
              </NavGroup>
            )}

            {may("items.manage") && (
              <NavGroup label="Products" icon={<Smartphone size={15} />} match={["/products", "/items"]}
                except={["/items/categories", "/items/subcategories", "/items/brands", "/items/attributes",
                         "/items/units", "/items/purchasing", "/items/stock"]}>
                <NavLink href="/products" exact>All products</NavLink>
                <NavLink href="/items" exact>Edit catalogue</NavLink>
                <NavLink href="/items/prices">Price levels</NavLink>
              </NavGroup>
            )}

            {may("inventory.view") && (
              <NavGroup label="Inventory" icon={<Boxes size={15} />} match={["/inventory", "/items/stock"]}>
                <NavLink href="/inventory" exact>Summary</NavLink>
                <NavLink href="/items/stock">Stock</NavLink>
                <NavLink href="/inventory/phones">IMEI / Serial Tracking</NavLink>
                {may("inventory.manage") && (company?.warehouses ?? 0) > 1 && <NavLink href="/inventory/transfer">Stock transfers</NavLink>}
                {may("inventory.manage") && <NavLink href="/inventory/adjustments">Stock count &amp; adjustments</NavLink>}
                <NavLink href="/reports/phone-stock">Inventory aging</NavLink>
                <NavLink href="/inventory/warranty">Warranty lookup</NavLink>
                <NavLink href="/inventory/movements">Stock movements</NavLink>
                <NavLink href="/inventory/replenishment">Replenishment</NavLink>
                <NavLink href="/inventory/negative-stock">Negative stock</NavLink>
                {wholesale && <NavLink href="/inventory/consignment" exact>Consignment</NavLink>}
              </NavGroup>
            )}

            {may("purchase.view") && (
              <NavGroup label="Purchases" icon={<Package size={15} />} match={["/purchases", "/payables"]}>
                <NavLink href="/purchases/orders" exact>Purchase orders</NavLink>
                <NavLink href="/purchases/receive" exact>Goods receipts</NavLink>
                <NavLink href="/purchases/received-not-invoiced">Received not invoiced</NavLink>
                <NavLink href="/purchases/invoices" exact>Purchase invoices</NavLink>
                <NavLink href="/purchases/returns" exact>Supplier returns</NavLink>
                <NavLink href="/purchases/debit-notes" exact>Debit notes</NavLink>
                {company && planIncludes(company.plan, "supplier_performance") && (
                  <NavLink href="/purchases/supplier-performance" exact>Supplier performance</NavLink>
                )}
                {may("accounting.view") && <NavLink href="/payables" exact>Payables</NavLink>}
                {may("accounting.post") && <NavLink href="/payables/pay">Pay supplier</NavLink>}
                <NavLink href="/settings/currencies">Currencies &amp; rates</NavLink>
              </NavGroup>
            )}

            <NavGroup label="Partners" icon={<Users size={15} />} match={["/partners"]}>
              <NavLink href="/partners?role=customer">Customers</NavLink>
              <NavLink href="/partners?role=supplier">Suppliers</NavLink>
              <NavLink href="/partners/categories" exact>Partner categories</NavLink>
            </NavGroup>

            {may("accounting.view") && (
              <NavGroup label="Accounting" icon={<BookOpen size={15} />} match={["/finance", "/ledger"]}>
                <NavSubGroup label="Cash &amp; bank" match={[
                  "/finance/cash-detail", "/finance/bank-detail", "/finance/cash-receipt",
                  "/finance/cash-payment", "/finance/bank-receipt", "/finance/bank-payment",
                  "/finance/transfer", "/finance/bank-reconciliation",
                ]}>
                  <NavLink href="/finance/cash-detail" sub>Cash book</NavLink>
                  <NavLink href="/finance/bank-detail" sub>Bank book</NavLink>
                  <NavLink href="/finance/cash-receipt" sub>Cash receipt</NavLink>
                  <NavLink href="/finance/cash-payment" sub>Cash payment</NavLink>
                  <NavLink href="/finance/bank-receipt" sub>Bank receipt</NavLink>
                  <NavLink href="/finance/bank-payment" sub>Bank payment</NavLink>
                  <NavLink href="/finance/bank-reconciliation" sub>Bank reconciliation</NavLink>
                  <NavLink href="/finance/transfer" sub>Interbranch transfer</NavLink>
                </NavSubGroup>
                <NavSubGroup label="Transactions" match={["/finance/journal", "/finance/opening", "/finance/year-end"]}>
                  <NavLink href="/finance/journal" sub>Journal Voucher</NavLink>
                  <NavLink href="/finance/year-end" sub>Year end</NavLink>
                  <NavLink href="/finance/opening" sub>Opening Balances</NavLink>
                </NavSubGroup>
                <NavSubGroup label="Ledgers" match={["/finance/general-ledger", "/ledger"]}>
                  <NavLink href="/finance/general-ledger" sub>General Ledger</NavLink>
                  <NavLink href="/ledger" sub>Trial Balance</NavLink>
                </NavSubGroup>
                <NavSubGroup label="Financial Reports" match={[
                  "/finance/income-statement", "/finance/balance-sheet", "/finance/cash-flow",
                  "/finance/inventory-cogs", "/finance/cash-cycle",
                ]}>
                  <NavLink href="/finance/income-statement" sub>Income Statement</NavLink>
                  <NavLink href="/finance/balance-sheet" sub>Balance Sheet</NavLink>
                  <NavLink href="/finance/cash-flow" sub>Cash Flow</NavLink>
                  <NavLink href="/finance/inventory-cogs" sub>Inventory &amp; COGS</NavLink>
                  <NavLink href="/finance/cash-cycle" sub>Cash Conversion Cycle</NavLink>
                </NavSubGroup>
                <NavLink href="/finance/aging">AR / AP Aging</NavLink>
                {wholesale && <NavLink href="/finance/shipped-not-invoiced">Shipped Not Invoiced</NavLink>}
              </NavGroup>
            )}

            {may("reports.view") && (
              <NavGroup label="Reports" icon={<BarChart3 size={15} />} match={["/reports", "/sales/reports"]}>
                <NavLink href="/reports/phone-sales">Sales &amp; margin</NavLink>
                <NavLink href="/reports/phone-stock">Stock &amp; aging</NavLink>
                <NavLink href="/sales/reports">Sales report (detailed)</NavLink>
              </NavGroup>
            )}

            {wholesale && may("settings.manage") && (
              <NavGroup label="Logistics" icon={<Truck size={15} />} match={["/logistics"]}>
                <NavLink href="/logistics/routes" exact>Routes</NavLink>
                <NavLink href="/logistics/trips" exact>Delivery trips</NavLink>
                <NavLink href="/logistics/vehicles" exact>Vehicles</NavLink>
                <NavLink href="/logistics/drivers" exact>Drivers</NavLink>
              </NavGroup>
            )}

            {may("settings.manage") && (
              <NavGroup label="Settings" icon={<Settings size={15} />} match={[
                "/warehouses", "/salespersons", "/settings", "/items/categories", "/items/subcategories",
                "/items/brands", "/items/attributes", "/items/units", "/items/purchasing",
              ]}>
                {/* Set once, read everywhere: the lists the rest of the app
                    is built from, grouped the way the iPhone's Settings is. */}
                {may("items.manage") && (
                  <NavSubGroup label="Catalogue" match={["/items/categories", "/items/subcategories", "/items/brands",
                    "/items/attributes", "/items/units", "/items/purchasing"]}>
                    <NavLink href="/items/categories" sub>Categories</NavLink>
                    <NavLink href="/items/subcategories" sub>Sub categories</NavLink>
                    <NavLink href="/items/brands" sub>Brands</NavLink>
                    <NavLink href="/items/attributes" sub>Variants (storage, colour)</NavLink>
                    <NavLink href="/items/units" sub>Units</NavLink>
                    <NavLink href="/items/purchasing" sub>Purchasing terms</NavLink>
                  </NavSubGroup>
                )}
                <NavSubGroup label="Company" match={["/warehouses", "/salespersons"]}>
                  <NavLink href="/warehouses" sub>Branches &amp; warehouses</NavLink>
                  <NavLink href="/salespersons" sub>Salespersons</NavLink>
                </NavSubGroup>
                <NavSubGroup label="Accounting" match={["/settings/accounts", "/settings/tax-codes", "/settings/currencies"]}>
                  <NavLink href="/settings/accounts" sub>Chart of Accounts</NavLink>
                  <NavLink href="/settings/tax-codes" sub>Tax codes</NavLink>
                  <NavLink href="/settings/currencies" sub>Currencies &amp; rates</NavLink>
                </NavSubGroup>
                <NavSubGroup label="Account" match={["/settings/plan", "/settings/users"]}>
                  <NavLink href="/settings/plan" sub>Package</NavLink>
                  {may("users.manage") && <NavLink href="/settings/users" sub>Users</NavLink>}
                </NavSubGroup>
              </NavGroup>
            )}

            <NavLink href="/documents" exact><FileText size={15} /> All documents</NavLink>

          </nav>

          <main className="main">
            {user && (
              <header className="topbar noprint">
                <form action="/search" className="topsearch" role="search">
                  <Search size={15} aria-hidden="true" />
                  <input name="q" placeholder="Search IMEI, invoice, customer…" aria-label="Search IMEI, invoice or customer" />
                </form>
                <details className="usermenu">
                  <summary aria-label={`${user.name}, ${ROLE_LABEL[user.role]}`}>{user.initials}</summary>
                  <div className="usermenu-pop">
                    <strong>{user.name}</strong>
                    <span>{ROLE_LABEL[user.role]}</span>
                    {authRequired()
                      ? <form action={signOut}><button className="linkish">Sign out</button></form>
                      : <span>Sign-in is off</span>}
                  </div>
                </details>
              </header>
            )}
            <div className="inner">
              {dbError ? (
                <div className="card">
                  <div className="card-head"><h2>Database unavailable</h2></div>
                  <div className="card-body">
                    <p className="page-sub">
                      The app could not reach the database. Check that
                      <span className="m"> DATABASE_URL</span> is set and reachable
                      from this environment.
                    </p>
                    <p className="m" style={{ color: "var(--bad)", marginTop: "0.75rem" }}>{dbError}</p>
                  </div>
                </div>
              ) : !company ? (
                <div className="card">
                  <div className="card-head"><h2>Nothing set up yet</h2></div>
                  <div className="card-body">
                    <p className="page-sub">
                      This database is empty. Creating a company builds the chart of
                      accounts, the financial calendar and the posting rules &mdash;
                      everything the ledger needs before anything can be recorded.
                    </p>
                    <div className="actions" style={{ marginTop: "1rem" }}>
                      <Link href="/setup" className="btn">Set up your company</Link>
                    </div>
                  </div>
                </div>
              ) : (
                children
              )}
            </div>
          </main>
        </div>
        <Toast />
      </body>
    </html>
  );
}
