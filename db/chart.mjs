// The chart of accounts, in one place.
//
// Three things build a chart and they must not disagree: lib/setup.ts when a
// company is created, scripts/load-coa.mjs when an existing company is
// re-charted, and db/seed.sql for the demo. They used to carry three
// different charts, so a report could be right in the demo and wrong in the
// product. This file is the one they all read.
//
// Plain .mjs on purpose: scripts/load-coa.mjs runs under node with no build
// step, and lib/setup.ts imports it through allowJs.

/** code, name, type, postable, flags
 *
 * Section codes are numbered, not lettered, because the chart is read in
 * `order by code` and letters sort alphabetically: H-CGS lands between H-CA
 * and H-CL, which puts Cost of Sales second, above the liabilities. The
 * leading digit matches the account block beneath it and the hyphen sorts
 * before any digit, so each section lands immediately ahead of its accounts.
 * They are never displayed — the Code column is blank on a section row. */
export const CHART = [
  // Assets are three groups deep, the customer's own layout: the group codes
  // are the prefixes of the account codes beneath them (1 → 11 → 113 → 11301),
  // so `order by code` still reads top-down.
  ["1",     "Assets",                            "ASSET",     false],
  ["11",    "Fixed Assets",                      "ASSET",     false, { under: "1" }],
  ["113",   "Machinery",                         "ASSET",     false, { under: "11" }],
  ["11301", "Generator & Solar",                 "ASSET",     true],
  ["114",   "Furniture and Office Equipment",    "ASSET",     false, { under: "11" }],
  ["11401", "Save/မီးခံသေတ္တာ",                  "ASSET",     true],
  ["11402", "Table, Chair & Locker",             "ASSET",     true],
  ["11403", "Computer & Printer",                "ASSET",     true],
  ["11404", "AirCon & Freezer",                  "ASSET",     true],
  ["11405", "Phone",                             "ASSET",     true],
  ["11406", "Office Equipment",                  "ASSET",     true],
  ["11407", "CCTV & Router",                     "ASSET",     true],
  ["115",   "Vehicles",                          "ASSET",     false, { under: "11" }],
  ["11501", "Cycle & EV Cycle",                  "ASSET",     true],
  ["121",   "Accumulated Depreciation",          "ASSET",     false, { under: "11" }],
  ["12101", "Accumulated Dep; Save/မီးခံသေတ္တာ", "ASSET",     true],
  ["12102", "Accumulated Dep; Table, Chair & Locker", "ASSET", true],
  ["12103", "Accumulated Dep; Computer & Printer", "ASSET",   true],
  ["12104", "Accumulated Dep; AirCon & Freezer", "ASSET",     true],
  ["12105", "Accumulated Dep; Phone",            "ASSET",     true],
  ["12106", "Accumulated Dep; Office Equipment", "ASSET",     true],
  ["12107", "Accumulated Dep; Cycle & EV Cycle", "ASSET",     true],
  ["12108", "Accumulated Dep; CCTV & Router",    "ASSET",     true],
  ["12109", "Accumulated Dep; Generator & Solar", "ASSET",    true],
  ["12110", "Accumulated Amor; Galaxy Software", "ASSET",     true],
  ["13",    "Current Assets",                    "ASSET",     false, { under: "1" }],
  ["131",   "Cash",                              "ASSET",     false, { under: "13" }],
  ["13101", "Cash Account",                      "ASSET",     true,  { cash: true }],
  ["13102", "Suspense Cash",                     "ASSET",     true,  { cash: true }],
  ["13103", "Yuan Cash",                         "ASSET",     true,  { cash: true }],
  // Both flags, deliberately. is_bank_account puts it in the bank book; the
  // payment and sales screens ask for is_cash_account, and a bank account you
  // cannot pay a supplier from is not much of a bank account. The cash book
  // asks for "cash and not bank", so these still stay out of it.
  ["132",   "Bank",                              "ASSET",     false, { under: "13" }],
  ["13201", "UAB Bank Call Account",             "ASSET",     true,  { cash: true, bank: true }],
  ["13202", "KBZ Bank Current Account",          "ASSET",     true,  { cash: true, bank: true }],
  ["13203", "Yoma Bank Flexi Account",           "ASSET",     true,  { cash: true, bank: true }],
  ["13204", "AYA Bank Account",                  "ASSET",     true,  { cash: true, bank: true }],
  ["13205", "CB Bank Account",                   "ASSET",     true,  { cash: true, bank: true }],
  ["13206", "Daw Nan Yu War",                    "ASSET",     true,  { cash: true, bank: true }],
  ["13207", "MMQR (UAB)",                        "ASSET",     true,  { cash: true, bank: true }],
  ["13208", "UAB Bank (Cheque) Account",         "ASSET",     true,  { cash: true, bank: true }],
  ["13209", "KBZ Bank (Cheque) Account",         "ASSET",     true,  { cash: true, bank: true }],
  ["13210", "Yoma Bank (Cheque) Account",        "ASSET",     true,  { cash: true, bank: true }],
  ["13211", "AYA Bank (Cheque) Account",         "ASSET",     true,  { cash: true, bank: true }],
  ["13212", "CB Bank (Cheque) Account",          "ASSET",     true,  { cash: true, bank: true }],
  ["133",   "Credit Card",                       "ASSET",     false, { under: "13" }],
  ["13301", "Credit Card",                       "ASSET",     true,  { cash: true, bank: true }],
  ["135",   "Accounts Receivable",               "ASSET",     false, { under: "13" }],
  ["13501", "Accounts Receivable",               "ASSET",     true,  { control: true }],
  ["138",   "Advance (Other Department)",        "ASSET",     false, { under: "13" }],
  ["13801", "Advance",                           "ASSET",     true],
  ["141",   "Inventory",                         "ASSET",     false, { under: "13" }],
  ["14101", "Inventory (Opening)",               "ASSET",     true],
  ["142",   "I.B.S.T",                           "ASSET",     false, { under: "13" }],
  ["14201", "Branch Stock Transfer",             "ASSET",     true],
  // Not in the customer's chart; the posting engine needs all three.
  ["143",   "Clearing & Tax",                    "ASSET",     false, { under: "13" }],
  ["14301", "GR/IR Clearing",                    "ASSET",     true,  { added: true }],
  // Commercial tax paid on purchases, creditable against tax charged on
  // sales. An asset while it is still owed back to us, not an expense — a
  // trader who expenses it pays it twice.
  ["14302", "Input Commercial Tax",              "ASSET",     true,  { added: true }],
  // The sales mirror of GR/IR. Goods have left and nobody has been billed
  // for them, so their cost is out of inventory and not yet cost of sales.
  // Nothing posts here yet — see docs/03-decisions.md, D8.
  ["14303", "Goods Shipped Not Invoiced",        "ASSET",     true,  { added: true }],
  // Where a landed-cost bill waits until it is spread over the goods (0135).
  ["14304", "Landed Cost Clearing",              "ASSET",     true,  { added: true }],
  ["151",   "Advance Paid",                      "ASSET",     false, { under: "13" }],
  ["15101", "Prepayment (Sup)",                  "ASSET",     true],
  // Paid to a supplier before they billed us. Ours until they do.
  ["15102", "Purchase Advance",                  "ASSET",     true],
  ["152",   "Prepaid Expenses",                  "ASSET",     false, { under: "13" }],
  ["15201", "Prepaid Rent",                      "ASSET",     true],
  ["15202", "Prepaid Tax",                       "ASSET",     true],
  ["15203", "Prepaid Delivery",                  "ASSET",     true],
  ["16",    "Intangible Assets",                 "ASSET",     false, { under: "1" }],
  ["161",   "Software",                          "ASSET",     false, { under: "16" }],
  ["16101", "Galaxy Software Installation",      "ASSET",     true],
  ["17",    "Other Assets",                      "ASSET",     false, { under: "1" }],
  ["171",   "Deferred Expenses",                 "ASSET",     false, { under: "17" }],
  ["17101", "Staff Loan",                        "ASSET",     true],
  ["2",     "Liabilities",                       "LIABILITY", false],
  ["21",    "Current Liabilities",               "LIABILITY", false, { under: "2" }],
  ["211",   "Accounts Payable",                  "LIABILITY", false, { under: "21" }],
  ["21101", "Accounts Payable",                  "LIABILITY", true,  { control: true }],
  ["21108", "Payable Expenses",                  "LIABILITY", true],
  ["21109", "Payable (Other)",                   "LIABILITY", true],
  ["21110", "Accrued Expense",                   "LIABILITY", true],
  ["213",   "Advance Received",                  "LIABILITY", false, { under: "21" }],
  // Taken from a customer before we billed them. Theirs until we do.
  ["21301", "Sale Advance",                      "LIABILITY", true],
  ["21302", "Prereceive Customer",               "LIABILITY", true],
  ["21307", "Sale Cash",                         "LIABILITY", true],
  ["214",   "Consign Stock",                     "LIABILITY", false, { under: "21" }],
  ["21401", "Consign Stock",                     "LIABILITY", true],
  ["21402", "Unpaid Sold Consign",               "LIABILITY", true],
  // Not in the customer's chart. Commercial tax charged on a sale is money
  // held for the revenue department, never income, so it needs a liability.
  ["215",   "Tax Payable",                       "LIABILITY", false, { under: "21" }],
  ["21501", "Commercial Tax Payable",            "LIABILITY", true,  { added: true }],
  ["23",    "Long-Term Liabilities",             "LIABILITY", false, { under: "2" }],
  ["230",   "Long-Term Liabilities",             "LIABILITY", false, { under: "23" }],
  ["23001", "Loan",                              "LIABILITY", true],
  ["3",     "Equity",                            "EQUITY",    false],
  ["31",    "Capital Stock",                     "EQUITY",    false, { under: "3" }],
  ["311",   "Founding Shares",                   "EQUITY",    false, { under: "31" }],
  ["31104", "Capital Stock",                     "EQUITY",    true],
  ["31105", "Capital",                           "EQUITY",    true],
  ["312",   "Ordinary Shares",                   "EQUITY",    false, { under: "31" }],
  ["31203", "Shares -Royal",                     "EQUITY",    true],
  ["31204", "Shares -ACT",                       "EQUITY",    true],
  ["31205", "Shares -RD",                        "EQUITY",    true],
  ["32",    "Profit & Loss",                     "EQUITY",    false, { under: "3" }],
  ["322",   "Profit and Loss",                   "EQUITY",    false, { under: "32" }],
  ["32201", "Profit and Loss",                   "EQUITY",    true],
  // Not in the customer's chart. Balances opening balances and nets to zero
  // once they are all in; posting them against capital would overstate it.
  ["33",    "Opening Balance",                   "EQUITY",    false, { under: "3" }],
  ["331",   "Opening Balance",                   "EQUITY",    false, { under: "33" }],
  ["33101", "Opening Balance Equity",            "EQUITY",    true,  { added: true }],
  ["4",     "Revenue",                           "REVENUE",   false],
  ["41",    "Sales",                             "REVENUE",   false, { under: "4" }],
  ["411",   "Sales",                             "REVENUE",   false, { under: "41" }],
  ["41101", "Sales (Default)",                   "REVENUE",   true],
  ["41102", "Sales(Consign)",                    "REVENUE",   true],
  ["41105", "FOC",                               "REVENUE",   true],
  // Charged to the customer for carrying the goods they bought. Not product
  // sales — but revenue all the same, because it exists only because the
  // sale did. Not in the customer's chart; the engine posts delivery fees here.
  ["41106", "Delivery Income",                   "REVENUE",   true,  { added: true }],
  ["412",   "Sale Discount",                     "REVENUE",   false, { under: "41" }],
  ["41201", "Sales Discounts",                   "REVENUE",   true],
  ["41202", "Sales Comm",                        "REVENUE",   true],
  ["413",   "Other Incomes",                     "REVENUE",   false, { under: "41" }],
  ["41301", "Other Incomes",                     "REVENUE",   true],
  ["43",    "Return In",                         "REVENUE",   false, { under: "4" }],
  ["431",   "Return In",                         "REVENUE",   false, { under: "43" }],
  ["43101", "Return In",                         "REVENUE",   true],
  ["43103", "ReturnIn Discount",                 "REVENUE",   true],
  ["43104", "ReturnInFOC",                       "REVENUE",   true],
  ["43105", "Return In (Charges)",               "REVENUE",   true],
  ["5",     "Cost of Goods Sold",                "COGS",      false],
  ["51",    "Purchase",                          "COGS",      false, { under: "5" }],
  ["511",   "Purchase",                          "COGS",      false, { under: "51" }],
  ["51101", "Branch Transfer (Stock)",           "COGS",      true],
  ["51105", "Purchase (Consignment)",            "COGS",      true],
  ["51107", "Pur Consign Opening",               "COGS",      true],
  ["51108", "Purchase",                          "COGS",      true],
  ["51109", "Purchase(Consign Adjust)",          "COGS",      true],
  ["51110", "Carriage Inward",                   "COGS",      true],
  ["512",   "Purchase Discount",                 "COGS",      false, { under: "51" }],
  ["51201", "Purchase Discounts",                "COGS",      true],
  ["51202", "FOC Received",                      "COGS",      true],
  ["513",   "Purchase Commission",               "COGS",      false, { under: "51" }],
  ["51301", "Purchase Commission",               "COGS",      true],
  ["52",    "Return Out",                        "COGS",      false, { under: "5" }],
  ["521",   "Return Out",                        "COGS",      false, { under: "52" }],
  ["52101", "Purchase Return",                   "COGS",      true],
  ["52102", "ReturnOut FOC",                     "COGS",      true],
  ["59",    "Adjustment",                        "COGS",      false, { under: "5" }],
  ["599",   "Adjustment",                        "COGS",      false, { under: "59" }],
  ["59902", "Adjust amount",                     "COGS",      true],
  ["59905", "Inventory Damage",                  "COGS",      true],
  ["59906", "Damage Control A/C",                "COGS",      true],
  // Not in the customer's chart. Absorbs a bill that differs from the
  // receipt it settles; folding it into Purchase would hide it inside cost.
  ["59907", "Purchase Price Variance",           "COGS",      true,  { added: true }],
  ["6",     "Expenses",                          "EXPENSE",   false],
  ["61",    "General Expenses",                  "EXPENSE",   false, { under: "6" }],
  ["612",   "Selling & Distribution Expenses",   "EXPENSE",   false, { under: "61" }],
  ["61252", "Salary",                            "EXPENSE",   true],
  ["61253", "Overtime",                          "EXPENSE",   true],
  ["61254", "Carriage Outward",                  "EXPENSE",   true],
  ["615",   "Inventory Expense",                 "EXPENSE",   false, { under: "61" }],
  ["61504", "Inventory Loss",                    "EXPENSE",   true],
  ["61506", "Office Use",                        "EXPENSE",   true],
  ["64",    "Sales & Marketing Expenses",        "EXPENSE",   false, { under: "6" }],
  ["641",   "Marketing Expenses",                "EXPENSE",   false, { under: "64" }],
  ["64102", "Sample",                            "EXPENSE",   true],
  ["64103", "Money Adjust",                      "EXPENSE",   true],
  ["64104", "Promotion",                         "EXPENSE",   true],
  ["64105", "Packing Materials",                 "EXPENSE",   true],
  ["66",    "Admin Expenses",                    "EXPENSE",   false, { under: "6" }],
  ["660",   "Phone Service Expenses",            "EXPENSE",   false, { under: "66" }],
  ["66001", "Exg.Rate Gain/Loss",                "EXPENSE",   true],
  ["66002", "Warranty Service Expenses",         "EXPENSE",   true],
  ["661",   "Administration Expenses",           "EXPENSE",   false, { under: "66" }],
  ["66101", "General Expenses",                  "EXPENSE",   true],
  ["66102", "Municipal Tax",                     "EXPENSE",   true],
  ["66103", "Training Expenses",                 "EXPENSE",   true],
  ["66104", "Entertainment Expenses",            "EXPENSE",   true],
  ["66105", "Rental Charges",                    "EXPENSE",   true],
  ["66106", "Internet & Email",                  "EXPENSE",   true],
  ["66107", "Cleaning Expenses",                 "EXPENSE",   true],
  ["66108", "Insurance Expenses",                "EXPENSE",   true],
  ["66109", "Bank Charges",                      "EXPENSE",   true],
  ["66110", "Tax & Rate : Government Fees",      "EXPENSE",   true],
  ["66111", "Software Maintenance Expenses",     "EXPENSE",   true],
  ["66112", "Meter Bill",                        "EXPENSE",   true],
  ["66113", "Printing & Stationery Expenses",    "EXPENSE",   true],
  ["66114", "Repair & Maintenance -Office Equipment", "EXPENSE", true],
  ["66115", "Transportation Expenses",           "EXPENSE",   true],
  ["66116", "Job Advertising Expenses",          "EXPENSE",   true],
  ["66117", "Professional Fees",                 "EXPENSE",   true],
  ["66118", "Phone Bill",                        "EXPENSE",   true],
  ["66119", "Staff Welfare",                     "EXPENSE",   true],
  ["66120", "Refreshment (water)",               "EXPENSE",   true],
  ["66121", "Cash Excess/ Deficit",              "EXPENSE",   true],
  ["66122", "Service Charges",                   "EXPENSE",   true],
  ["66123", "Other Materials",                   "EXPENSE",   true],
  ["663",   "Machinery Depreciation Expenses",   "EXPENSE",   false, { under: "66" }],
  ["66301", "Depreciation For Generator/Solar",  "EXPENSE",   true],
  ["664",   "Furniture & Office Equipment Depr; Exp;", "EXPENSE", false, { under: "66" }],
  ["66401", "Depreciation For Save/ မီးခံသေတ္တာ", "EXPENSE",  true],
  ["66402", "Depreciation For Table, Chair & Locker", "EXPENSE", true],
  ["66403", "Depreciation For Computer & Printer", "EXPENSE", true],
  ["66404", "Depreciation For AirCon & Freezer", "EXPENSE",   true],
  ["66405", "Depreciation For Phone",            "EXPENSE",   true],
  ["66406", "Depreciation For Office Equipment", "EXPENSE",   true],
  ["66407", "Depreciation For CCTV & Router",    "EXPENSE",   true],
  ["665",   "Vehicles Depreciation Exp;",        "EXPENSE",   false, { under: "66" }],
  ["66501", "Depreciation For Cycle & EV Cycle", "EXPENSE",   true],
  ["666",   "Galaxy Amortisation",               "EXPENSE",   false, { under: "66" }],
  ["66601", "Amortisation For Galaxy software",  "EXPENSE",   true],
  // Not trading income, so not part of revenue. A group of its own so the
  // income statement shows what the business earned by trading before what
  // it earned some other way (app/finance/income-statement reads code "7").
  ["7",     "Others",                            "REVENUE",   false],
  ["71",    "Other Income",                      "REVENUE",   false, { under: "7" }],
  ["712",   "Tax Received",                      "REVENUE",   false, { under: "71" }],
  ["71204", "Sale Tax",                          "REVENUE",   true],
  ["714",   "Cash Service Income",               "REVENUE",   false, { under: "71" }],
  ["71401", "Service Income",                    "REVENUE",   true],
  ["71402", "Bank Interest",                     "REVENUE",   true],
  ["75",    "Currency Conversion Adjustment",    "REVENUE",   false, { under: "7" }],
  ["755",   "Currency Conversion Adjustment",    "REVENUE",   false, { under: "75" }],
  ["75501", "Currency Conversion Adjust",        "REVENUE",   true],
  ["75502", "Trial Adjust",                      "REVENUE",   true],
];

// Where the posting engine resolves each role. Getting one of these wrong
// does not fail — it posts, balanced, to the wrong account, which is the
// failure mode migration 0022 exists to record.
export const SYSTEM = {
  GRIR_CLEARING: "14301", OPENING_BALANCE_EQUITY: "33101", RETAINED_EARNINGS: "32201",
  PURCHASE_PRICE_VARIANCE: "59907", PURCHASE_DISCOUNT_RECEIVED: "51201",
  SALES_DISCOUNT_ALLOWED: "41201", PROMOTION_EXPENSE: "64104", STOCK_ADJUSTMENT: "59902",

  // Mostly homes the chart already has, rather than accounts nobody asked for
  // — a rounding difference is a miscellaneous cost and stays one.
  //
  // Two exceptions, both about which side of the operating line money falls.
  // A delivery fee is earned because a sale happened, so it is revenue and
  // belongs above that line — kept out of 4000 Sales because it is not product
  // sales, but revenue nonetheless. An exchange difference is the opposite: it
  // is what happened to money between agreeing a price and settling it, and
  // belongs below. So the gain sits in Other Income and the loss now has an
  // account of its own instead of hiding inside Miscellaneous Expenses.
  // The customer keeps both directions in one account, 66001.
  FX_GAIN: "66001", FX_LOSS: "66001", ROUNDING_DIFFERENCE: "66121",
  DELIVERY_INCOME: "41106",

  // Reserved. Cost of sales is still recognised on the delivery, so nothing
  // resolves this role yet; it exists so the account and the role land
  // together rather than in two migrations months apart.
  SHIPPED_NOT_INVOICED: "14303", LANDED_COST_CLEARING: "14304",

  // Money that moved before the invoice did. Deliberately not the control
  // accounts: an advance has no open item, so parking it in receivables would
  // put the ledger and the subledger out of step the moment it was taken —
  // and it is not a receivable anyway. It is something owed to the customer
  // until the goods go, and something owed to us until the supplier delivers.
  CUSTOMER_ADVANCE: "21301", SUPPLIER_ADVANCE: "15102",

  // Commercial tax. Charged on a sale it is money held for the revenue
  // department, never income; paid on a purchase it is creditable against
  // what we charge, so it sits in assets until it is set off.
  OUTPUT_TAX: "21501", INPUT_TAX: "14302",
};

// COGS points at 51108 "Purchase" — they are the same account here. The
// customer's chart is written for a periodic system, where purchases
// accumulate in Purchase and cost of sales is computed at period end. This app is
// perpetual FIFO: a goods receipt debits Inventory, never Purchase, and cost
// of goods sold posts as the goods leave. So 51108 is the account doing that
// job, and a second "Cost of Goods Sold" beside it would be the same thing
// under two names.
export const DETERMINATION = {
  AR_CONTROL: "13501", AP_CONTROL: "21101", INVENTORY: "14101",
  COGS: "51108", REVENUE: "41101", SALES_RETURN: "43101",
};

/**
 * Free-of-charge reasons a new company starts with. The account each writes
 * off to is what keeps a giveaway out of cost of sales, so a promotion is
 * visible as promotion rather than quietly eroding gross margin.
 */
export const FOC_REASONS = [
  ["PROMOTION", "Promotional giveaway", "64104"],
  ["SAMPLE",    "Customer sample",      "64102"],
  ["OFFICE",    "Office use",           "61506"],
  ["DAMAGED",   "Damaged or expired",   "59905"],
];
