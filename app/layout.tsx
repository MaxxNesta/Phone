import type { Metadata } from "next";
import { Noto_Sans_Myanmar, Geist } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { LanguageSwitcher } from "@/components/language-switcher";
import "flag-icons/css/flag-icons.min.css";
import "./globals.css";
import Link from "next/link";
import { getCompany } from "@/lib/queries";
import { planIncludes } from "@/lib/plans";
import { NavLink, NavGroup, NavSubGroup } from "./nav";
import { MobileNav } from "@/components/mobile-nav";
import { SidebarCollapse } from "@/components/sidebar-collapse";
import { Toast } from "@/components/toast";
import {
  LayoutDashboard, ShoppingCart, Package, BookOpen, Landmark, Boxes, Truck, ScanLine, Users, BarChart3, Settings,
  Smartphone, FileText, Search,
} from "lucide-react";
import { headers } from "next/headers";
import { currentUser, can, authRequired, type Permission } from "@/lib/auth";
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
// Inter was replaced by Geist (2026-10-19, owner's choice): it keeps the
// tabular figures that make a column of amounts line up, and gives the app a
// cleaner, more current face.
//
// Myanmar still falls through to Noto: Geist has no Burmese glyphs, and a
// name in Burmese must not silently lose its shapes to a fallback.
const geist = Geist({
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

// The tab names the company, not the software: a shop's staff and customers
// see this, and "Retail" describes how it was set up, not who it is.
export async function generateMetadata(): Promise<Metadata> {
  const company = await getCompany().catch(() => null);
  return {
    title: company?.name ? String(company.name) : "ERP",
    description: "Point of sale, IMEI stock and accounting",
  };
}

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let company: Awaited<ReturnType<typeof getCompany>> = null;
  let dbError: string | null = null;

  // Sign-in and first-run screens draw without the application around them.
  const h = await headers();
  const path = h.get("x-pathname") ?? "";
  // The middleware's Content-Security-Policy runs only scripts carrying this.
  const nonce = h.get("x-nonce") ?? undefined;
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
  // The interface language: English, or Myanmar laid over it (i18n/request.ts).
  const locale = await getLocale();
  const messages = await getMessages();
  const n = await getTranslations("nav");
  const sh = await getTranslations("shell");
  const roleT = await getTranslations("roles");
  // Distribution screens (orders, deliveries, routes) only in the trading flow.
  const wholesale = company ? !company.retail_mode : false;

  if (bare) {
    return (
      <html lang={locale} className={`${geist.variable} ${notoMyanmar.variable}`}>
        <body><NextIntlClientProvider locale={locale} messages={messages}><main className="bare">{children}</main><Toast /></NextIntlClientProvider></body>
      </html>
    );
  }

  return (
    <html lang={locale} className={`${geist.variable} ${notoMyanmar.variable}`}>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
        {/* Before first paint, so a rail somebody collapsed yesterday does not
            flash open and shove the page sideways on the way in. The effect in
            SidebarCollapse runs after paint, which is too late to prevent that
            — this is the same reason a theme preference is read here. */}
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html:
              "try{if(localStorage.getItem('navCollapsed')==='true')"
              + "document.body.dataset.navCollapsed='true'}catch(e){}",
          }}
        />
        <DatePickerFix />
        <div className="shell">
          <MobileNav
            title={company?.name ?? sh("appName")}
            subtitle={company?.base_currency ?? sh("notSetUp")}
          />
          <nav className="sidebar" id="sidebar">
            <div className="brand">
              <span className="brand-name">{company?.name ?? sh("appName")}</span>
              <span className="brand-sub">{company?.base_currency ?? sh("notSetUp")}</span>
            </div>

            <SidebarCollapse />

            <NavLink href="/" exact><LayoutDashboard size={15} /> <span className="navlink-text">{n("dashboard")}</span></NavLink>

            {may("pos.sell") && <NavLink href="/pos"><ScanLine size={15} /> <span className="navlink-text">{n("counterSale")}</span></NavLink>}

            {may("sales.view") && (
              <NavGroup label={n("salesHistory")} icon={<ShoppingCart size={15} />} match={["/sales", "/receivables"]}>
                <NavLink href="/sales/invoices" exact>{n("salesInvoices")}</NavLink>
                {wholesale && <NavLink href="/sales/orders" exact>{n("salesOrders")}</NavLink>}
                {wholesale && <NavLink href="/sales/deliver">{n("deliveries")}</NavLink>}
                {wholesale && <NavLink href="/sales/consignment">{n("consignmentSale")}</NavLink>}
                <NavLink href="/sales/returns" exact>{n("customerReturns")}</NavLink>
                <NavLink href="/sales/credit-notes" exact>{n("creditNotes")}</NavLink>
                <NavLink href="/sales/discounts" exact>{n("volumeDiscounts")}</NavLink>
                <NavLink href="/sales/discounts-given" exact>{n("discountsGiven")}</NavLink>
                <NavLink href="/receivables" exact>{n("receivables")}</NavLink>
                <NavLink href="/receivables/advances">{n("customerAdvances")}</NavLink>
                <NavLink href="/receivables/receive">{n("receivePayment")}</NavLink>
              </NavGroup>
            )}

            {may("items.manage") && (
              <NavGroup label={n("products")} icon={<Smartphone size={15} />} match={["/products", "/items"]}
                except={["/items/categories", "/items/subcategories", "/items/brands", "/items/attributes",
                         "/items/units", "/items/purchasing", "/items/stock"]}>
                <NavLink href="/products" exact>{n("allProducts")}</NavLink>
                <NavLink href="/items/prices">{n("priceLevels")}</NavLink>
              </NavGroup>
            )}

            {may("inventory.view") && (
              <NavGroup label={n("inventory")} icon={<Boxes size={15} />} match={["/inventory", "/items/stock"]}>
                <NavLink href="/inventory" exact>{n("summary")}</NavLink>
                <NavLink href="/items/stock">{n("stock")}</NavLink>
                <NavLink href="/inventory/phones">{n("imeiTracking")}</NavLink>
                {may("inventory.manage") && (company?.warehouses ?? 0) > 1 && <NavLink href="/inventory/transfer">{n("stockTransfers")}</NavLink>}
                {may("inventory.manage") && <NavLink href="/inventory/adjustments">{n("stockCount")}</NavLink>}
                <NavLink href="/reports/phone-stock">{n("inventoryAging")}</NavLink>
                <NavLink href="/inventory/warranty">{n("warrantyLookup")}</NavLink>
                <NavLink href="/inventory/movements">{n("stockMovements")}</NavLink>
                <NavLink href="/inventory/replenishment">{n("replenishment")}</NavLink>
                <NavLink href="/inventory/negative-stock">{n("negativeStock")}</NavLink>
                {wholesale && <NavLink href="/inventory/consignment" exact>{n("consignment")}</NavLink>}
              </NavGroup>
            )}

            {may("purchase.view") && (
              <NavGroup label={n("purchases")} icon={<Package size={15} />} match={["/purchases", "/payables"]}>
                <NavLink href="/purchases/orders" exact>{n("purchaseOrders")}</NavLink>
                <NavLink href="/purchases/receive" exact>{n("goodsReceipts")}</NavLink>
                <NavLink href="/purchases/received-not-invoiced">{n("receivedNotInvoiced")}</NavLink>
                <NavLink href="/purchases/invoices" exact>{n("purchaseInvoices")}</NavLink>
                <NavLink href="/purchases/returns" exact>{n("supplierReturns")}</NavLink>
                <NavLink href="/purchases/debit-notes" exact>{n("debitNotes")}</NavLink>
                {may("cost.view") && <NavLink href="/purchases/landed-costs">{n("landedCosts")}</NavLink>}
                {company && planIncludes(company.plan, "supplier_performance") && (
                  <NavLink href="/purchases/supplier-performance" exact>{n("supplierPerformance")}</NavLink>
                )}
                {may("accounting.view") && <NavLink href="/payables" exact>{n("payables")}</NavLink>}
                {may("accounting.post") && <NavLink href="/payables/pay">{n("paySupplier")}</NavLink>}
              </NavGroup>
            )}

            <NavGroup label={n("partners")} icon={<Users size={15} />} match={["/partners"]}>
              <NavLink href="/partners?role=customer">{n("customers")}</NavLink>
              <NavLink href="/partners?role=supplier">{n("suppliers")}</NavLink>
              <NavLink href="/partners/categories" exact>{n("partnerCategories")}</NavLink>
            </NavGroup>

            {may("accounting.view") && (
              <NavGroup label={n("accounting")} icon={<BookOpen size={15} />} match={["/finance", "/ledger"]}>
                <NavSubGroup label={n("cashBank")} match={[
                  "/finance/cash-detail", "/finance/bank-detail", "/finance/cash-receipt",
                  "/finance/cash-payment", "/finance/bank-receipt", "/finance/bank-payment",
                  "/finance/transfer", "/finance/bank-reconciliation", "/finance/payments",
                ]}>
                  <NavLink href="/finance/cash-detail" sub>{n("cashBook")}</NavLink>
                  <NavLink href="/finance/bank-detail" sub>{n("bankBook")}</NavLink>
                  <NavLink href="/finance/cash-receipt" sub>{n("cashReceipt")}</NavLink>
                  <NavLink href="/finance/cash-payment" sub>{n("cashPayment")}</NavLink>
                  <NavLink href="/finance/bank-receipt" sub>{n("bankReceipt")}</NavLink>
                  <NavLink href="/finance/bank-payment" sub>{n("bankPayment")}</NavLink>
                  <NavLink href="/finance/bank-reconciliation" sub>{n("bankReconciliation")}</NavLink>
                  <NavLink href="/finance/payments" sub>{n("paymentsReceived")}</NavLink>
                  <NavLink href="/finance/transfer" sub>{n("interbranchTransfer")}</NavLink>
                </NavSubGroup>
                <NavSubGroup label={n("transactions")} match={["/finance/journal", "/finance/opening", "/finance/year-end"]}>
                  <NavLink href="/finance/journal" sub>{n("journalVoucher")}</NavLink>
                  <NavLink href="/finance/year-end" sub>{n("yearEnd")}</NavLink>
                  <NavLink href="/finance/opening" sub>{n("openingBalances")}</NavLink>
                </NavSubGroup>
                <NavSubGroup label={n("ledgers")} match={["/finance/general-ledger", "/ledger"]}>
                  <NavLink href="/finance/general-ledger" sub>{n("generalLedger")}</NavLink>
                  <NavLink href="/ledger" sub>{n("trialBalance")}</NavLink>
                </NavSubGroup>
                <NavSubGroup label={n("financialReports")} match={[
                  "/finance/income-statement", "/finance/balance-sheet", "/finance/cash-flow",
                  "/finance/inventory-cogs", "/finance/cash-cycle",
                ]}>
                  <NavLink href="/finance/income-statement" sub>{n("incomeStatement")}</NavLink>
                  <NavLink href="/finance/balance-sheet" sub>{n("balanceSheet")}</NavLink>
                  <NavLink href="/finance/cash-flow" sub>{n("cashFlow")}</NavLink>
                  <NavLink href="/finance/inventory-cogs" sub>{n("inventoryCogs")}</NavLink>
                  <NavLink href="/finance/cash-cycle" sub>{n("cashCycle")}</NavLink>
                </NavSubGroup>
                <NavLink href="/finance/aging">{n("arApAging")}</NavLink>
                {wholesale && <NavLink href="/finance/shipped-not-invoiced">{n("shippedNotInvoiced")}</NavLink>}
              </NavGroup>
            )}

            {/* The asset subledger: it feeds the ledger above, through its journals. */}
            {may("accounting.view") && (
              <NavGroup label={n("fixedAssets")} icon={<Landmark size={15} />} match={["/fixed-assets"]}>
                <NavLink href="/fixed-assets" exact>{n("faOverview")}</NavLink>
                <NavLink href="/fixed-assets/register">{n("assetRegister")}</NavLink>
                <NavLink href="/fixed-assets/calendar">{n("depCalendar")}</NavLink>
                <NavLink href="/fixed-assets/reconcile">{n("faReconcile")}</NavLink>
                <NavLink href="/fixed-assets/settings">{n("faSettings")}</NavLink>
              </NavGroup>
            )}

            {may("reports.view") && (
              <NavGroup label={n("reports")} icon={<BarChart3 size={15} />} match={["/reports", "/sales/reports"]}>
                <NavLink href="/reports/phone-sales">{n("salesMargin")}</NavLink>
                <NavLink href="/reports/phone-stock">{n("stockAging")}</NavLink>
                <NavLink href="/sales/reports">{n("salesReportDetailed")}</NavLink>
                <NavLink href="/reports/price-history">{n("priceHistory")}</NavLink>
              </NavGroup>
            )}

            {wholesale && may("settings.manage") && (
              <NavGroup label={n("logistics")} icon={<Truck size={15} />} match={["/logistics"]}>
                <NavLink href="/logistics/routes" exact>{n("routes")}</NavLink>
                <NavLink href="/logistics/trips" exact>{n("deliveryTrips")}</NavLink>
                <NavLink href="/logistics/vehicles" exact>{n("vehicles")}</NavLink>
                <NavLink href="/logistics/drivers" exact>{n("drivers")}</NavLink>
              </NavGroup>
            )}

            {(may("settings.manage") || may("receipts.manage")) && (
              <NavGroup label={n("settings")} icon={<Settings size={15} />} match={[
                "/warehouses", "/salespersons", "/settings", "/items/categories", "/items/subcategories",
                "/items/brands", "/items/attributes", "/items/units", "/items/purchasing",
              ]}>
                {/* Set once, read everywhere: the lists the rest of the app
                    is built from, grouped the way the iPhone's Settings is. */}
                {may("items.manage") && (
                  <NavSubGroup label={n("catalogue")} match={["/items/categories", "/items/subcategories", "/items/brands",
                    "/items/attributes", "/items/units", "/items/purchasing", "/items/import"]}>
                    <NavLink href="/items/categories" sub>{n("categories")}</NavLink>
                    <NavLink href="/items/subcategories" sub>{n("subCategories")}</NavLink>
                    <NavLink href="/items/brands" sub>{n("brands")}</NavLink>
                    <NavLink href="/items/attributes" sub>{n("variants")}</NavLink>
                    <NavLink href="/items/units" sub>{n("units")}</NavLink>
                    <NavLink href="/items/purchasing" sub>{n("purchasingTerms")}</NavLink>
                    <NavLink href="/items/import" sub>{n("importItems")}</NavLink>
                  </NavSubGroup>
                )}
                <NavSubGroup label={n("posSettings")} match={["/settings/receipt-templates"]}>
                  <NavLink href="/settings/receipt-templates" sub>{n("receiptTemplates")}</NavLink>
                </NavSubGroup>
                {may("settings.manage") && (<>
                <NavSubGroup label={n("company")} match={["/warehouses", "/salespersons"]}>
                  <NavLink href="/warehouses" sub>{n("branchesWarehouses")}</NavLink>
                  <NavLink href="/salespersons" sub>{n("salespersons")}</NavLink>
                </NavSubGroup>
                <NavSubGroup label={n("purchasing")} match={["/settings/landed-cost-types", "/settings/landed-cost-templates"]}>
                  <NavLink href="/settings/landed-cost-types" sub>{n("landedCostTypes")}</NavLink>
                  <NavLink href="/settings/landed-cost-templates" sub>{n("landedCostTemplates")}</NavLink>
                </NavSubGroup>
                <NavSubGroup label={n("accounting")} match={["/settings/accounts", "/settings/tax-codes", "/settings/currencies", "/settings/payment-methods"]}>
                  <NavLink href="/settings/accounts" sub>{n("chartOfAccounts")}</NavLink>
                  <NavLink href="/settings/tax-codes" sub>{n("taxCodes")}</NavLink>
                  <NavLink href="/settings/currencies" sub>{n("currencies")}</NavLink>
                  <NavLink href="/settings/payment-methods" sub>{n("paymentMethods")}</NavLink>
                </NavSubGroup>
                <NavSubGroup label={n("account")} match={["/settings/plan", "/settings/users"]}>
                  <NavLink href="/settings/plan" sub>{n("package")}</NavLink>
                  {may("users.manage") && <NavLink href="/settings/users" sub>{n("users")}</NavLink>}
                </NavSubGroup>
                </>)}
              </NavGroup>
            )}

            <NavLink href="/documents" exact><FileText size={15} /> {n("allDocuments")}</NavLink>

          </nav>

          <main className="main">
            {user && (
              <header className="topbar noprint">
                <form action="/search" className="topsearch" role="search">
                  <Search size={15} aria-hidden="true" />
                  <input name="q" placeholder={sh("searchPlaceholder")} aria-label={sh("searchLabel")} />
                </form>
                <LanguageSwitcher />
                <details className="usermenu">
                  <summary aria-label={`${user.name}, ${roleT(user.role)}`}>{user.initials}</summary>
                  <div className="usermenu-pop">
                    <strong>{user.name}</strong>
                    <span>{roleT(user.role)}</span>
                    {authRequired()
                      ? <form action={signOut}><button className="linkish">{sh("signOut")}</button></form>
                      : <span>{sh("signInOff")}</span>}
                  </div>
                </details>
              </header>
            )}
            <div className="inner">
              {dbError ? (
                <div className="card">
                  <div className="card-head"><h2>{sh("dbUnavailableTitle")}</h2></div>
                  <div className="card-body">
                    <p className="page-sub">{sh("dbUnavailableBody")}</p>
                    <p className="m" style={{ color: "var(--bad)", marginTop: "0.75rem" }}>{dbError}</p>
                  </div>
                </div>
              ) : !company ? (
                <div className="card">
                  <div className="card-head"><h2>{sh("emptyTitle")}</h2></div>
                  <div className="card-body">
                    <p className="page-sub">{sh("emptyBody")}</p>
                    <div className="actions" style={{ marginTop: "1rem" }}>
                      <Link href="/setup" className="btn">{sh("setUpCompany")}</Link>
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
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
