// Posts the 2026 shareholder capital receipts as cash/bank vouchers.
// Dr cash/bank, Cr the shareholder's equity account. Re-runnable: skips a row
// already posted (same type, date, money account, amount, memo).
import postgres from "postgres";
const { postCashVoucher, postBankVoucher } = await import("../lib/posting.ts");
const sql = postgres(process.env.DATABASE_URL, { max: 1 });

const D1 = "RD မှ ဒုတိယအကြိမ်သွင်းငွေ (1500Lakh)အတွက် (21.12.2025)";
const rows = [
  // [date, money acct, equity acct, reference, memo, amount]
  ["2026-01-01", "1110", "3150", "sa25120004/CashBook", D1, 4050000],
  ["2026-01-01", "1110", "3150", "sa25120005/CashBook", D1, 1483000],
  ["2026-01-08", "1110", "3130", "sa26010009/CashBook", "Royal မှ စတုတ္ထအကြိမ်သွင်းငွေ", 100000000],
  ["2026-01-01", "1123", "3130", null, "Royal မှ ပထမအကြိမ်သွင်းငွေ (27.11.2025)", 50000000],
  ["2026-01-01", "1123", "3140", null, "ACT မှ ပထမအကြိမ်သွင်းငွေ (27.11.2025)", 50000000],
  ["2026-01-01", "1123", "3140", null, "ACT မှ ဒုတိယအကြိမ်သွင်းငွေ (20.12.2025)", 150000000],
  ["2026-01-01", "1123", "3150", null, "RD မှ ပထမအကြိမ်သွင်းငွေ (27.11.2025)", 50000000],
  ["2026-01-01", "1123", "3150", null, "RD မှ ဒုတိယအကြိမ်သွင်းငွေ (1500Lakh)အတွက် (20.12.2025)", 120000000],
  ["2026-01-01", "1123", "3150", null, D1, 24467000],
  ["2026-01-06", "1121", "3140", null, "ACT မှ တတိယအကြိမ်သွင်းငွေ (သိန်းငါးရာအတွက်)", 26000000],
  ["2026-01-08", "1121", "3140", null, "ACT မှ စတုတ္ထအကြိမ်သွင်းငွေ", 100000000],
  ["2026-01-08", "1121", "3150", null, "RD မှ စတုတ္ထအကြိမ်သွင်းငွေ", 100000000],
  ["2026-01-06", "1122", "3150", null, "RD မှ တတိယအကြိမ်သွင်းငွေ (သိန်းငါးရာအတွက်)", 20000000],
  ["2026-01-07", "1122", "3150", null, "RD မှ တတိယအကြိမ်သွင်းငွေ (သိန်းငါးရာအတွက်)", 30000000],
];

const [co] = await sql`select id, name from company`;
console.log("Company:", co.name);
const acct = Object.fromEntries((await sql`select code, id from account where company_id = ${co.id}`).map((r) => [r.code, r.id]));
for (const c of ["1110","1121","1122","1123","3130","3140","3150"]) if (!acct[c]) throw new Error("Missing account " + c);
const [ho] = await sql`select id from location where company_id = ${co.id} and code = 'MAIN'`;
if (!ho) throw new Error("No MAIN branch");

let posted = 0, skipped = 0;
for (const [date, money, eq, ref, memo, amt] of rows) {
  const type = money === "1110" ? "CASH_VOUCHER" : "BANK_VOUCHER";
  const [dup] = await sql`
    select d.doc_no from document d join journal_entry je on je.source_id = d.id
      join journal_line l on l.journal_entry_id = je.id
     where d.company_id = ${co.id} and d.doc_type = ${type} and d.doc_date = ${date}::date and d.memo = ${memo}
       and l.account_id = ${acct[money]} and l.base_amount = ${amt} limit 1`;
  if (dup) { console.log("skip", dup.doc_no, money, amt); skipped++; continue; }
  const fn = type === "CASH_VOUCHER" ? postCashVoucher : postBankVoucher;
  const r = await fn({ companyId: co.id, docDate: date, memo, reference: ref, locationId: ho.id,
    lines: [{ accountId: acct[money], amount: amt, memo }, { accountId: acct[eq], amount: -amt, memo }] });
  console.log("posted", r.docNo, date, money, eq, amt); posted++;
}
console.log({ posted, skipped });
console.table(await sql`select a.code, a.name, sum(l.base_amount)::float as balance from journal_line l join account a on a.id = l.account_id
  where a.company_id = ${co.id} and a.code in ('1110','1121','1122','1123','3130','3140','3150') group by 1,2 order by 1`);
await sql.end();
process.exit(0);
