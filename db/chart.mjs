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
 * Three levels: class (1 digit) → group (2 digits) → account (4 digits). The
 * account's first two digits are its group and the first digit its class, so
 * `order by code` reads top-down and every account is two steps from its class
 * (4 Revenue → 41 Sales → 4110 Sales).
 *
 * `from` names what the account was before migration 0203 renumbered the chart
 * (the customer's legacy 5-digit codes, kept on each account as legacy_code).
 * On a group it lists the legacy headings it replaces, so an account the chart
 * does not know is still filed under the right group.
 *
 * Sections the statements read by code — keep them in step with lib/queries.ts
 * (totalsAt), lib/financial-ratios.ts and lib/format.ts SECTION_TYPE_LABEL:
 *   current assets 1-CA (11–15) · non-current assets 1-NC (16–19)
 *   current liabilities 2-CL (21–24, 26) · non-current liabilities 2-NL (25)
 *   sales 41 · other operating income 42 · other income class 7 · finance costs 69
 */
export const CHART = [
  ["1",    "Assets",                                   "ASSET",     false],
  // The balance sheet's own split (0208); groups 11–15 current, 16–19 not.
  ["1-CA", "Current Assets",                           "ASSET",     false, { under: "1" }],
  ["11",   "Cash and Bank",                            "ASSET",     false, { under: "1-CA", from: ["131", "132", "133"] }],
  ["1110", "Cash Account",                             "ASSET",     true,  { from: "13101", cash: true }],
  ["1111", "Suspense Cash",                            "ASSET",     true,  { from: "13102", cash: true }],
  ["1112", "Yuan Cash",                                "ASSET",     true,  { from: "13103", cash: true }],
  ["1113", "Cash with Drivers",                        "ASSET",     true],
  // Both flags, deliberately. is_bank_account puts it in the bank book; the
  // payment and sales screens ask for is_cash_account, and a bank account you
  // cannot pay a supplier from is not much of a bank account. The cash book
  // asks for "cash and not bank", so these still stay out of it.
  ["1120", "UAB Bank Call Account",                    "ASSET",     true,  { from: "13201", cash: true, bank: true }],
  ["1121", "KBZ Bank Current Account",                 "ASSET",     true,  { from: "13202", cash: true, bank: true }],
  ["1122", "Yoma Bank Flexi Account",                  "ASSET",     true,  { from: "13203", cash: true, bank: true }],
  ["1123", "AYA Bank Account",                         "ASSET",     true,  { from: "13204", cash: true, bank: true }],
  ["1124", "CB Bank Account",                          "ASSET",     true,  { from: "13205", cash: true, bank: true }],
  ["1125", "Daw Nan Yu War",                           "ASSET",     true,  { from: "13206", cash: true, bank: true }],
  ["1126", "MMQR (UAB)",                               "ASSET",     true,  { from: "13207", cash: true, bank: true }],
  ["1127", "UAB Bank (Cheque) Account",                "ASSET",     true,  { from: "13208", cash: true, bank: true }],
  ["1128", "KBZ Bank (Cheque) Account",                "ASSET",     true,  { from: "13209", cash: true, bank: true }],
  ["1129", "Yoma Bank (Cheque) Account",               "ASSET",     true,  { from: "13210", cash: true, bank: true }],
  ["1130", "AYA Bank (Cheque) Account",                "ASSET",     true,  { from: "13211", cash: true, bank: true }],
  ["1131", "CB Bank (Cheque) Account",                 "ASSET",     true,  { from: "13212", cash: true, bank: true }],
  ["1140", "Credit Card",                              "ASSET",     true,  { from: "13301", cash: true, bank: true }],
  // Month-end restatement of foreign cash at the closing rate (0223): beside
  // the cash accounts, so each still agrees with its statement. Nil except
  // between a month-end entry and its reversal the next day.
  ["1150", "Foreign Cash Revaluation",                 "ASSET",     true,  { added: true }],
  ["12",   "Receivables",                              "ASSET",     false, { under: "1-CA", from: ["135", "138"] }],
  ["1210", "Accounts Receivable",                      "ASSET",     true,  { from: "13501", control: true }],
  ["1220", "Advance (Other Department)",               "ASSET",     true,  { from: "13801" }],
  ["1230", "COD Receivable (Courier)",                 "ASSET",     true],
  ["13",   "Inventory",                                "ASSET",     false, { under: "1-CA", from: ["141", "142"] }],
  // The one inventory account: every receipt, sale and adjustment moves it.
  // It was "Inventory (Opening)" in the legacy chart, which it never was.
  ["1310", "Inventory",                                "ASSET",     true,  { from: "14101" }],
  ["1320", "Branch Stock Transfer",                    "ASSET",     true,  { from: "14201" }],
  // Not in the customer's chart; the posting engine needs all four.
  ["14",   "Clearing and Tax",                         "ASSET",     false, { under: "1-CA", from: ["143"] }],
  ["1410", "GR/IR Clearing",                           "ASSET",     true,  { from: "14301", added: true }],
  // The sales mirror of GR/IR. Goods have left and nobody has been billed
  // for them, so their cost is out of inventory and not yet cost of sales.
  ["1420", "Goods Shipped Not Invoiced",               "ASSET",     true,  { from: "14303", added: true }],
  // Where a landed-cost bill waits until it is spread over the goods (0135).
  ["1430", "Landed Cost Clearing",                     "ASSET",     true,  { from: "14304", added: true }],
  // Commercial tax paid on purchases, creditable against tax charged on
  // sales. An asset while it is still owed back to us, not an expense.
  ["1440", "Input Commercial Tax",                     "ASSET",     true,  { from: "14302", added: true }],
  // A trade-in's bill and sale settle against each other here; nets to nothing (0209).
  ["1450", "Trade-in Clearing",                        "ASSET",     true],
  ["15",   "Advances and Prepayments",                 "ASSET",     false, { under: "1-CA", from: ["13", "151", "152"] }],
  ["1510", "Prepayment (Sup)",                         "ASSET",     true,  { from: "15101" }],
  // Paid to a supplier before they billed us. Ours until they do.
  ["1520", "Purchase Advance",                         "ASSET",     true,  { from: "15102" }],
  ["1530", "Prepaid Rent",                             "ASSET",     true,  { from: "15201" }],
  ["1540", "Prepaid Tax",                              "ASSET",     true,  { from: "15202" }],
  ["1550", "Prepaid Delivery",                         "ASSET",     true,  { from: "15203" }],
  // A supplier rebate earned before their credit note (0207).
  ["1560", "Supplier Rebates Receivable",              "ASSET",     true],
  ["1-NC", "Non-current Assets",                       "ASSET",     false, { under: "1" }],
  ["16",   "Property, Plant and Equipment",            "ASSET",     false, { under: "1-NC", from: ["11", "113", "114", "115"] }],
  ["1601", "Land",                                     "ASSET",     true],
  ["1602", "Buildings",                                "ASSET",     true],
  ["1610", "Generator & Solar",                        "ASSET",     true,  { from: "11301" }],
  ["1620", "Save/မီးခံသေတ္တာ",                          "ASSET",     true,  { from: "11401" }],
  ["1621", "Table, Chair & Locker",                    "ASSET",     true,  { from: "11402" }],
  ["1622", "Computer & Printer",                       "ASSET",     true,  { from: "11403" }],
  ["1623", "AirCon & Freezer",                         "ASSET",     true,  { from: "11404" }],
  ["1624", "Phone",                                    "ASSET",     true,  { from: "11405" }],
  ["1625", "Office Equipment",                         "ASSET",     true,  { from: "11406" }],
  ["1626", "CCTV & Router",                            "ASSET",     true,  { from: "11407" }],
  ["1630", "Cycle & EV Cycle",                         "ASSET",     true,  { from: "11501" }],
  ["17",   "Accumulated Depreciation and Amortisation", "ASSET",    false, { under: "1-NC", from: ["121"] }],
  // Land is not depreciated, so it has no accumulated depreciation.
  ["1701", "Accumulated Dep; Buildings",               "ASSET",     true],
  ["1710", "Accumulated Dep; Generator & Solar",       "ASSET",     true,  { from: "12109" }],
  ["1720", "Accumulated Dep; Save/မီးခံသေတ္တာ",         "ASSET",     true,  { from: "12101" }],
  ["1721", "Accumulated Dep; Table, Chair & Locker",   "ASSET",     true,  { from: "12102" }],
  ["1722", "Accumulated Dep; Computer & Printer",      "ASSET",     true,  { from: "12103" }],
  ["1723", "Accumulated Dep; AirCon & Freezer",        "ASSET",     true,  { from: "12104" }],
  ["1724", "Accumulated Dep; Phone",                   "ASSET",     true,  { from: "12105" }],
  ["1725", "Accumulated Dep; Office Equipment",        "ASSET",     true,  { from: "12106" }],
  ["1726", "Accumulated Dep; CCTV & Router",           "ASSET",     true,  { from: "12108" }],
  ["1730", "Accumulated Dep; Cycle & EV Cycle",        "ASSET",     true,  { from: "12107" }],
  ["1740", "Accumulated Amor; Galaxy Software",        "ASSET",     true,  { from: "12110" }],
  ["18",   "Intangible Assets",                        "ASSET",     false, { under: "1-NC", from: ["16", "161"] }],
  ["1810", "Galaxy Software Installation",             "ASSET",     true,  { from: "16101" }],
  ["19",   "Other Non-current Assets",                 "ASSET",     false, { under: "1-NC", from: ["17", "171"] }],
  ["1910", "Staff Loan",                               "ASSET",     true,  { from: "17101" }],

  ["2",    "Liabilities",                              "LIABILITY", false],
  ["2-CL", "Current Liabilities",                      "LIABILITY", false, { under: "2" }],
  ["21",   "Trade and Other Payables",                 "LIABILITY", false, { under: "2-CL", from: ["21", "211"] }],
  ["2110", "Accounts Payable",                         "LIABILITY", true,  { from: "21101", control: true }],
  ["2120", "Payable Expenses",                         "LIABILITY", true,  { from: "21108" }],
  ["2130", "Payable (Other)",                          "LIABILITY", true,  { from: "21109" }],
  ["2140", "Accrued Expense",                          "LIABILITY", true,  { from: "21110" }],
  // What payroll owes staff until they are paid (HR settings, 0186).
  ["2150", "Salary Payable",                           "LIABILITY", true],
  // The same for what suppliers are owed in yuan (0223), beside AP so the
  // supplier ledger keeps agreeing with the open bills.
  ["2160", "Foreign Payables Revaluation",             "LIABILITY", true,  { added: true }],
  ["22",   "Advances and Deferred Revenue",            "LIABILITY", false, { under: "2-CL", from: ["213"] }],
  // Taken from a customer before we billed them. Theirs until we do.
  ["2210", "Sale Advance",                             "LIABILITY", true,  { from: "21301" }],
  ["2220", "Prereceive Customer",                      "LIABILITY", true,  { from: "21302" }],
  // Billed and not yet delivered: the price waits here until the goods go.
  ["2230", "Billed Not Delivered (Unearned Revenue)",  "LIABILITY", true,  { from: "21303" }],
  ["2240", "Sale Cash",                                "LIABILITY", true,  { from: "21307" }],
  // A customer rebate to be paid out or credited later: IFRS 15 refund liability (0207).
  ["2250", "Rebates Payable (Refund Liability)",       "LIABILITY", true],
  ["23",   "Consignment",                              "LIABILITY", false, { under: "2-CL", from: ["214"] }],
  ["2310", "Consign Stock",                            "LIABILITY", true,  { from: "21401" }],
  ["2320", "Unpaid Sold Consign",                      "LIABILITY", true,  { from: "21402" }],
  // Commercial tax charged on a sale is money held for the revenue
  // department, never income, so it needs a liability.
  ["24",   "Tax Payable",                              "LIABILITY", false, { under: "2-CL", from: ["215"] }],
  ["2410", "Commercial Tax Payable",                   "LIABILITY", true,  { from: "21501", added: true }],
  // Loans due within a year, and the part of a long-term loan that is.
  ["26",   "Short-term Borrowings",                    "LIABILITY", false, { under: "2-CL" }],
  ["2610", "Short-term Loan",                          "LIABILITY", true],
  ["2620", "Current Portion of Long-term Loan",        "LIABILITY", true],
  ["2-NL", "Non-current Liabilities",                  "LIABILITY", false, { under: "2" }],
  ["25",   "Long-term Borrowings",                     "LIABILITY", false, { under: "2-NL", from: ["23", "230"] }],
  ["2510", "Loan",                                     "LIABILITY", true,  { from: "23001" }],

  ["3",    "Equity",                                   "EQUITY",    false],
  ["31",   "Share Capital",                            "EQUITY",    false, { under: "3", from: ["31", "311", "312"] }],
  ["3110", "Capital Stock",                            "EQUITY",    true,  { from: "31104" }],
  ["3120", "Capital",                                  "EQUITY",    true,  { from: "31105" }],
  ["3130", "Shares -Royal",                            "EQUITY",    true,  { from: "31203" }],
  ["3140", "Shares -ACT",                              "EQUITY",    true,  { from: "31204" }],
  ["3150", "Shares -RD",                               "EQUITY",    true,  { from: "31205" }],
  ["32",   "Retained Earnings",                        "EQUITY",    false, { under: "3", from: ["32", "322"] }],
  ["3210", "Profit and Loss",                          "EQUITY",    true,  { from: "32201" }],
  // Balances opening balances and nets to zero once they are all in; posting
  // them against capital would overstate it.
  ["33",   "Opening Balance",                          "EQUITY",    false, { under: "3", from: ["33", "331"] }],
  ["3310", "Opening Balance Equity",                   "EQUITY",    true,  { from: "33101", added: true }],

  ["4",    "Revenue",                                  "REVENUE",   false],
  // Sales and everything that reduces them: returns and discounts are revenue
  // given back, so they sit with sales and show as deductions from it.
  ["41",   "Sales",                                    "REVENUE",   false, { under: "4", from: ["41", "411", "412", "43", "431"] }],
  ["4110", "Sales",                                    "REVENUE",   true,  { from: "41101" }],
  ["4120", "Sales (Consignment)",                      "REVENUE",   true,  { from: "41102" }],
  // Charged to the customer for carrying the goods they bought. Not product
  // sales, but revenue all the same: it exists only because the sale did.
  ["4130", "Delivery Income",                          "REVENUE",   true,  { from: "41106", added: true }],
  ["4140", "FOC",                                      "REVENUE",   true,  { from: "41105" }],
  ["4180", "Sales Returns",                            "REVENUE",   true,  { from: "43101" }],
  ["4181", "Sales Returns - Discount",                 "REVENUE",   true,  { from: "43103" }],
  ["4182", "Sales Returns - FOC",                      "REVENUE",   true,  { from: "43104" }],
  ["4183", "Sales Returns - Charges",                  "REVENUE",   true,  { from: "43105" }],
  ["4190", "Sales Discounts",                          "REVENUE",   true,  { from: "41201" }],
  ["4191", "Sales Commission",                         "REVENUE",   true,  { from: "41202" }],
  ["42",   "Other Operating Income",                   "REVENUE",   false, { under: "4", from: ["413"] }],
  ["4210", "Other Incomes",                            "REVENUE",   true,  { from: "41301" }],

  ["5",    "Cost of Sales",                            "COGS",      false],
  ["51",   "Cost of Goods Sold",                       "COGS",      false, { under: "5", from: ["51", "511", "512", "513", "52", "521"] }],
  // The perpetual FIFO cost of everything sold. The legacy chart called it
  // "Purchase" (51108) because it was written for a periodic system.
  ["5110", "Cost of Goods Sold",                       "COGS",      true,  { from: "51108" }],
  ["5120", "Carriage Inward",                          "COGS",      true,  { from: "51110" }],
  ["5130", "Purchase Discounts",                       "COGS",      true,  { from: "51201" }],
  ["5140", "FOC Received",                             "COGS",      true,  { from: "51202" }],
  ["5150", "Purchase Commission",                      "COGS",      true,  { from: "51301" }],
  ["5160", "Purchase Returns",                         "COGS",      true,  { from: "52101" }],
  ["5161", "Purchase Returns - FOC",                   "COGS",      true,  { from: "52102" }],
  ["5170", "Purchase (Consignment)",                   "COGS",      true,  { from: "51105" }],
  ["5171", "Purchase Consignment Opening",             "COGS",      true,  { from: "51107" }],
  ["5172", "Purchase (Consignment Adjust)",            "COGS",      true,  { from: "51109" }],
  ["5180", "Branch Transfer (Stock)",                  "COGS",      true,  { from: "51101" }],
  ["59",   "Inventory Adjustments",                    "COGS",      false, { under: "5", from: ["59", "599"] }],
  ["5910", "Adjust Amount",                            "COGS",      true,  { from: "59902" }],
  ["5920", "Inventory Damage",                         "COGS",      true,  { from: "59905" }],
  ["5930", "Damage Control A/C",                       "COGS",      true,  { from: "59906" }],
  // Absorbs a bill that differs from the receipt where no goods are left to
  // carry the difference; folding it into cost would hide it.
  ["5940", "Purchase Price Variance",                  "COGS",      true,  { from: "59907", added: true }],

  ["6",    "Operating Expenses",                       "EXPENSE",   false],
  ["61",   "Selling and Distribution",                 "EXPENSE",   false, { under: "6", from: ["61", "612"] }],
  ["6110", "Salary",                                   "EXPENSE",   true,  { from: "61252" }],
  ["6120", "Overtime",                                 "EXPENSE",   true,  { from: "61253" }],
  ["6130", "Carriage Outward",                         "EXPENSE",   true,  { from: "61254" }],
  ["62",   "Marketing",                                "EXPENSE",   false, { under: "6", from: ["64", "641"] }],
  ["6210", "Sample",                                   "EXPENSE",   true,  { from: "64102" }],
  ["6220", "Money Adjust",                             "EXPENSE",   true,  { from: "64103" }],
  ["6230", "Promotion",                                "EXPENSE",   true,  { from: "64104" }],
  ["6240", "Packing Materials",                        "EXPENSE",   true,  { from: "64105" }],
  ["63",   "Administrative",                           "EXPENSE",   false, { under: "6", from: ["66", "661", "615", "660"] }],
  ["6301", "General Expenses",                         "EXPENSE",   true,  { from: "66101" }],
  ["6302", "Municipal Tax",                            "EXPENSE",   true,  { from: "66102" }],
  ["6303", "Training Expenses",                        "EXPENSE",   true,  { from: "66103" }],
  ["6304", "Entertainment Expenses",                   "EXPENSE",   true,  { from: "66104" }],
  ["6305", "Rental Charges",                           "EXPENSE",   true,  { from: "66105" }],
  ["6306", "Internet & Email",                         "EXPENSE",   true,  { from: "66106" }],
  ["6307", "Cleaning Expenses",                        "EXPENSE",   true,  { from: "66107" }],
  ["6308", "Insurance Expenses",                       "EXPENSE",   true,  { from: "66108" }],
  ["6309", "Bank Charges",                             "EXPENSE",   true,  { from: "66109" }],
  ["6310", "Tax & Rate : Government Fees",             "EXPENSE",   true,  { from: "66110" }],
  ["6311", "Software Maintenance Expenses",            "EXPENSE",   true,  { from: "66111" }],
  ["6312", "Meter Bill",                               "EXPENSE",   true,  { from: "66112" }],
  ["6313", "Printing & Stationery Expenses",           "EXPENSE",   true,  { from: "66113" }],
  ["6314", "Repair & Maintenance -Office Equipment",   "EXPENSE",   true,  { from: "66114" }],
  ["6315", "Transportation Expenses",                  "EXPENSE",   true,  { from: "66115" }],
  ["6316", "Job Advertising Expenses",                 "EXPENSE",   true,  { from: "66116" }],
  ["6317", "Professional Fees",                        "EXPENSE",   true,  { from: "66117" }],
  ["6318", "Phone Bill",                               "EXPENSE",   true,  { from: "66118" }],
  ["6319", "Staff Welfare",                            "EXPENSE",   true,  { from: "66119" }],
  ["6320", "Refreshment (water)",                      "EXPENSE",   true,  { from: "66120" }],
  ["6321", "Cash Excess/ Deficit",                     "EXPENSE",   true,  { from: "66121" }],
  ["6322", "Service Charges",                          "EXPENSE",   true,  { from: "66122" }],
  ["6323", "Other Materials",                          "EXPENSE",   true,  { from: "66123" }],
  ["6330", "Inventory Loss",                           "EXPENSE",   true,  { from: "61504" }],
  ["6331", "Office Use",                               "EXPENSE",   true,  { from: "61506" }],
  ["6340", "Exchange Rate Gain/Loss",                  "EXPENSE",   true,  { from: "66001" }],
  // Month-end restatement of what is still owed in yuan (0222): not money
  // gained or lost yet, and reversed the next day, so kept apart from 6340.
  ["6341", "Unrealised Exchange Gain/Loss",            "EXPENSE",   true,  { added: true }],
  ["6350", "Warranty Service Expenses",                "EXPENSE",   true,  { from: "66002" }],
  ["64",   "Depreciation and Amortisation",            "EXPENSE",   false, { under: "6", from: ["663", "664", "665", "666"] }],
  ["6401", "Depreciation For Buildings",               "EXPENSE",   true],
  ["6410", "Depreciation For Generator/Solar",         "EXPENSE",   true,  { from: "66301" }],
  ["6420", "Depreciation For Save/ မီးခံသေတ္တာ",        "EXPENSE",   true,  { from: "66401" }],
  ["6421", "Depreciation For Table, Chair & Locker",   "EXPENSE",   true,  { from: "66402" }],
  ["6422", "Depreciation For Computer & Printer",      "EXPENSE",   true,  { from: "66403" }],
  ["6423", "Depreciation For AirCon & Freezer",        "EXPENSE",   true,  { from: "66404" }],
  ["6424", "Depreciation For Phone",                   "EXPENSE",   true,  { from: "66405" }],
  ["6425", "Depreciation For Office Equipment",        "EXPENSE",   true,  { from: "66406" }],
  ["6426", "Depreciation For CCTV & Router",           "EXPENSE",   true,  { from: "66407" }],
  ["6430", "Depreciation For Cycle & EV Cycle",        "EXPENSE",   true,  { from: "66501" }],
  ["6440", "Amortisation For Galaxy software",         "EXPENSE",   true,  { from: "66601" }],
  ["69",   "Finance Costs",                            "EXPENSE",   false, { under: "6", from: ["67", "671"] }],
  ["6910", "Interest Expense",                         "EXPENSE",   true,  { from: "67101" }],

  // Not trading income, so not part of revenue: the income statement shows
  // what the business earned by trading before what it earned some other way
  // (app/finance/income-statement reads class "7").
  ["7",    "Other Income",                             "REVENUE",   false],
  ["71",   "Other Income",                             "REVENUE",   false, { under: "7", from: ["71", "712", "714", "75", "755"] }],
  ["7110", "Service Income",                           "REVENUE",   true,  { from: "71401" }],
  ["7120", "Bank Interest",                            "REVENUE",   true,  { from: "71402" }],
  ["7130", "Sale Tax",                                 "REVENUE",   true,  { from: "71204" }],
  ["7140", "Currency Conversion Adjust",               "REVENUE",   true,  { from: "75501" }],
  ["7150", "Trial Adjust",                             "REVENUE",   true,  { from: "75502" }],
];

// Where the posting engine resolves each role. Getting one of these wrong
// does not fail — it posts, balanced, to the wrong account, which is the
// failure mode migration 0022 exists to record.
export const SYSTEM = {
  GRIR_CLEARING: "1410", OPENING_BALANCE_EQUITY: "3310", RETAINED_EARNINGS: "3210",
  PURCHASE_PRICE_VARIANCE: "5940", PURCHASE_DISCOUNT_RECEIVED: "5130",
  SALES_DISCOUNT_ALLOWED: "4190", PROMOTION_EXPENSE: "6230", STOCK_ADJUSTMENT: "5910",

  // A rounding difference is a miscellaneous cost and stays one. The customer
  // keeps both exchange directions in one account.
  FX_GAIN: "6340", FX_LOSS: "6340", ROUNDING_DIFFERENCE: "6321",
  // The month-end revaluation (0223), apart from what was realised.
  FX_UNREALISED_GAIN: "6341", FX_UNREALISED_LOSS: "6341",
  FX_REVALUATION_CASH: "1150", FX_REVALUATION_AP: "2160",
  DELIVERY_INCOME: "4130",

  // Delivered goods wait here until the invoice recognises their cost; a
  // landed-cost bill waits in clearing until it is spread onto the phones.
  SHIPPED_NOT_INVOICED: "1420", LANDED_COST_CLEARING: "1430",
  // What a courier or driver named on a landed-cost charge is owed.
  OTHER_PAYABLE: "2130",
  // A courier's bill is booked here, then spread from here onto the phones.
  CARRIAGE_INWARD: "5120",
  // Cash on delivery a courier has collected and not yet paid in (0232); its fee.
  COD_RECEIVABLE: "1230", CARRIAGE_OUTWARD: "6130",
  // COD cash a driver collected at the door and has not handed in (0233).
  CASH_WITH_DRIVERS: "1113",

  // Money that moved before the invoice did. Deliberately not the control
  // accounts: an advance has no open item.
  CUSTOMER_ADVANCE: "2210", SUPPLIER_ADVANCE: "1520",
  // An invoice raised before its goods leave: the sale is earned on delivery,
  // so the price is held here until then (migration 0191).
  BILLED_NOT_DELIVERED: "2230",
  // A trade-in's payment and receipt pass through it and cancel (0209).
  TRADE_IN_CLEARING: "1450",

  // Commercial tax: held for the revenue department on a sale, creditable on
  // a purchase.
  OUTPUT_TAX: "2410", INPUT_TAX: "1440",
};

// This app is perpetual FIFO: a goods receipt debits Inventory, and cost of
// goods sold posts as the goods leave — to 5110 Cost of Goods Sold.
export const DETERMINATION = {
  AR_CONTROL: "1210", AP_CONTROL: "2110", INVENTORY: "1310",
  COGS: "5110", REVENUE: "4110", SALES_RETURN: "4180",
};

/**
 * Free-of-charge reasons a new company starts with. A standalone giveaway
 * (promotion, sample, office use, damage) writes off to its own account so it
 * is visible as what it was. A free item given with a sale is not one of
 * these: it is part of the sale and its cost is cost of sales.
 */
export const FOC_REASONS = [
  ["PROMOTION", "Promotional giveaway", "6230"],
  ["SAMPLE",    "Customer sample",      "6210"],
  ["OFFICE",    "Office use",           "6331"],
  ["DAMAGED",   "Damaged or expired",   "5920"],
];

