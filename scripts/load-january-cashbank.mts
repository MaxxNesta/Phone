// January 2026 cash and bank, from the old system's reports (2026-11-26).
//
//   npx tsx --env-file=.env scripts/load-january-cashbank.mts --dry     (plan and check; writes nothing)
//   npx tsx --env-file=.env scripts/load-january-cashbank.mts           (post on DEV)
//   … --force                                                           (any database but DEV: only with the owner's OK)
//
// Files (D:\phone): Cash Account Transaction - 13101.xlsx, Bank Transaction -
// All.xlsx; checked against Jan RPT_CUSTOMEROUTSTANDING_SUMMARY.xlsx and
// Jan RPT_SUPPLIEROUTSTANDING_SUMMARY.xlsx. Runs after load-january-2026.mts
// (purchases, sales) and post-capital-2026.mjs.
//
// Each report line becomes one document, its description as the memo and its
// old voucher number (cash lines only) as the reference:
// - AR / AP lines: Receive payment / Pay supplier. Each goes against that
//   partner's invoices dated on or before the payment, the invoice the old
//   line names first (cash lines), then the oldest. Money paid before the
//   goods were billed, or more than was owed, goes on account as an advance,
//   and the advance is applied to the next invoices on their own dates — the
//   way the old ledger ran negative and came back.
// - A line whose other side is another cash or bank account (it appears once
//   in each account's section): one transfer.
// - Payable (Other): paid to the Unnamed courier against its carriage
//   charges, oldest first.
// - Shares: already posted by post-capital-2026.mjs; checked, not posted.
// - Everything else: a cash or bank voucher to the account of that name.
// Also posted, from Journal Transaction.xlsx, the supplier entries with no
// cash or bank side (the shareholders paying China directly, the box-damage
// compensation passed to MSBN, two rounding discounts), so the supplier
// balances agree with the old summary. Depreciation is the fixed assets
// module's, not this script's.
import ExcelJS from "exceljs";
import { sql } from "../lib/db";
import { postCustomerReceipt, postSupplierPayment, applyAdvance, postCashVoucher, postBankVoucher, postCashTransfer } from "../lib/posting";
import { payCourier } from "../lib/courier-payables";

const DIR = process.env.JAN_DIR ?? "D:/phone";
const args = new Set(process.argv.slice(2));
const dry = args.has("--dry");
const [co] = await sql`select id, name from company order by created_at limit 1`;
if (!/\bDEV\b/.test(co.name) && !args.has("--force")) throw new Error(`${co.name} is not DEV. Pass --force only with the owner's OK.`);
console.log(`${co.name}${dry ? " · dry run, nothing written" : ""}`);
const C = co.id as string;

// ------------------------------------------------------------ reading --
const text = (v: any): string => v == null ? "" : typeof v === "object" ? ("result" in v ? String(v.result) : "richText" in v ? v.richText.map((r: any) => r.text).join("") : v instanceof Date ? v.toISOString().slice(0, 10) : "") : String(v);
const num = (s: string) => Number(String(s).replace(/,/g, "")) || 0;
type Line = { file: string; section: string; row: number; date: string; ref: string; acct: string; desc: string; amount: number /* + in, - out */ };
async function readReport(file: string, first: string): Promise<Line[]> {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(`${DIR}/${file}`); const ws = wb.worksheets[0];
  const head = Array.from(ws.getRow(6).values as any[], (x) => text(x).trim());
  const col = (l: string) => head.findIndex((h) => h === l);
  const K = { date: col("Date"), ref: col("Ref No"), acct: col("Acct Name"), desc: col("Description"), dr: col("Debit"), cr: col("Credit") };
  const out: Line[] = []; let section = first;
  ws.eachRow((r, i) => {
    if (i <= 6) return;
    const v = Array.from(r.values as any[], (x) => text(x).trim());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v[K.date] ?? "")) {
      const f = v.find((x) => x) ?? "";
      if (f && !/^(Currency|Branch|Opening|Closing|K Total|Main Branch Total)/.test(f) && !/Total =>/.test(f)) section = f;
      return;
    }
    out.push({ file, section, row: i, date: v[K.date], ref: K.ref > 0 ? v[K.ref] : "", acct: v[K.acct], desc: v[K.desc] ?? "",
      amount: num(v[K.dr]) - num(v[K.cr]) });
  });
  return out;
}
const lines = [...await readReport("Cash Account Transaction - 13101.xlsx", "Cash Account"), ...await readReport("Bank Transaction - All.xlsx", "")];

async function readSummary(file: string, nameCol: number, balCol: number) {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(`${DIR}/${file}`); const ws = wb.worksheets[0];
  const m = new Map<string, number>();
  ws.eachRow((r, i) => { if (i < 9) return; const name = text(r.getCell(nameCol).value).trim(); const sr = text(r.getCell(nameCol === 8 ? 3 : 2).value).trim();
    if (name && /^\d+$/.test(sr)) m.set(name, num(text(r.getCell(balCol).value))); });
  return m;
}
const oldAR = await readSummary("Jan RPT_CUSTOMEROUTSTANDING_SUMMARY.xlsx", 8, 21);
const oldAP = await readSummary("Jan RPT_SUPPLIEROUTSTANDING_SUMMARY.xlsx", 6, 21);

// ------------------------------------------------------------- master --
const accounts = await sql`select id, code, name, is_cash_account or is_bank_account as money from account where company_id = ${C} and is_postable`;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\u1000-\u109f]/g, "");
const ALIAS: Record<string, string> = { "Transporation Expenses": "6315", "Phone": "1624", "Advance": "1220" };
const acctOf = (name: string) => {
  if (ALIAS[name]) return accounts.find((a) => a.code === ALIAS[name])!;
  const m = accounts.filter((a) => norm(a.name) === norm(name) || norm(a.name).startsWith(norm(name)));
  if (m.length !== 1) throw new Error(`Account "${name}": ${m.length} matches`);
  return m[0];
};
const byCode = (c: string) => accounts.find((a) => a.code === c)!.id as string;
const [ho] = await sql`select id from location where company_id = ${C} and code = 'MAIN'`;
if (!ho) throw new Error("No MAIN branch");
const partners = await sql`
  select p.id, p.code, p.name, p.is_customer, p.is_supplier,
         (select count(*) from document d where d.partner_id = p.id and d.doc_type in ('SALES_INVOICE','PURCHASE_INVOICE') and d.status = 'POSTED')::int as docs
    from business_partner p where p.company_id = ${C}`;
const partnerOf = (name: string, side: "AR" | "AP") => {
  let m = partners.filter((p) => (side === "AR" ? p.is_customer : p.is_supplier) && norm(p.name) === norm(name));
  if (m.length > 1) m = m.filter((p) => p.name === name).length === 1 ? m.filter((p) => p.name === name) : m.filter((p) => p.docs > 0);
  if (m.length !== 1) throw new Error(`${side} partner "${name}": ${m.length} matches`);
  return m[0];
};

// ------------------------------------------------------------ planning --
type Pay = { side: "AR" | "AP"; partnerId: string; name: string; date: string; amount: number; moneyId: string; memo: string | null; ref: string | null; src: string };
const pays: Pay[] = [];
const vouchers: { kind: "CASH" | "BANK"; date: string; lines: { accountId: string; amount: number }[]; memo: string; ref: string | null; src: string }[] = [];
const transfers: { date: string; from: string; to: string; amount: number; memo: string; ref: string | null; src: string }[] = [];
const courier: { date: string; amount: number; moneyId: string; memo: string; ref: string | null; src: string }[] = [];
const sharesSeen: Line[] = [];
const used = new Set<Line>();
const src = (l: Line) => `${l.file.startsWith("Cash") ? "cash" : "bank"} r${l.row}`;

for (const l of lines) {
  if (used.has(l)) continue;
  const money = acctOf(l.section);
  if (!money.money) throw new Error(`Section "${l.section}" is not a cash or bank account`);
  const memo = l.desc || null, ref = l.ref || null;
  if (/^(AR|AP) - /.test(l.acct)) {
    const side = l.acct.slice(0, 2) as "AR" | "AP";
    const p = partnerOf(l.acct.slice(5), side);
    const amount = side === "AR" ? l.amount : -l.amount;
    if (amount <= 0) throw new Error(`${src(l)}: money going the wrong way for ${l.acct}`);
    pays.push({ side, partnerId: p.id, name: p.name, date: l.date, amount, moneyId: money.id, memo, ref, src: src(l) });
    continue;
  }
  if (/^Shares/.test(l.acct)) { sharesSeen.push(l); continue; }
  const other = acctOf(l.acct);
  if (other.money) {
    const mirror = lines.find((m) => !used.has(m) && m !== l && m.section === l.acct && m.acct === l.section && m.date === l.date && m.amount === -l.amount);
    if (!mirror) throw new Error(`${src(l)}: transfer with no matching line in ${l.acct}`);
    used.add(mirror);
    const out = l.amount < 0 ? l : mirror, inn = l.amount < 0 ? mirror : l;
    transfers.push({ date: l.date, from: acctOf(out.section).id, to: acctOf(inn.section).id, amount: Math.abs(l.amount),
      memo: out.desc || inn.desc, ref: out.ref || inn.ref || null, src: `${src(out)} + ${src(inn)}` });
    continue;
  }
  if (other.code === "2130") { courier.push({ date: l.date, amount: -l.amount, moneyId: money.id, memo: l.desc, ref, src: src(l) }); continue; }
  vouchers.push({ kind: money.code === "1110" ? "CASH" : "BANK", date: l.date, memo: l.desc, ref, src: src(l),
    lines: [{ accountId: money.id, amount: l.amount }, { accountId: other.id, amount: -l.amount }] });
}

// Supplier entries with no cash or bank side (Journal Transaction.xlsx).
const china = partnerOf("China", "AP"), thai = partnerOf("Thai", "AP");
for (const [ref, date, p, code, amount, memo] of [
  ["sa25120003", "2026-01-01", china, "3130", 150000000, "Royal မှ ဒုတိယအကြိမ်သွင်းငွေ (Ma Nan KBZ နဲ့ MSBNဆီလွှဲ) 21.12.2025"],
  ["sa26010028", "2026-01-01", china, "5130", 458, "purchase discount-458Ks, China (27.12.2025)"],
  ["sa26010029", "2026-01-06", china, "3140", 24000000, "ACT share 24,000,000 ကို MSBNဆီ AYAနှင့် တိုက်ရိုက်လွှဲ"],
  ["sa26010030", "2026-01-06", china, "3130", 50000000, "Royal share 50,000,000 ကို MSBNဆီ တိုက်ရိုက်လွှဲ 28,800,000(KBZ)+12,700,000(Yoma)+8,500,000(UAB)"],
  ["sa26010031", "2026-01-06", china, "4210", 400000, "ဖုန်းဘူးပြဲ၍ ကားဂိတ်မှအလျော်ရငွေကို MSBNထံလွှဲ"],
  ["sa26010024", "2026-01-26", thai, "5130", 66, null],
] as const) pays.push({ side: "AP", partnerId: p.id, name: p.name, date, amount, moneyId: byCode(code), memo, ref, src: `journal ${ref}` });

// Shares: every line already on the books as a capital voucher.
const capital = await sql`
  select d.doc_date::text as date, l.base_amount::float as amount, a.code from document d
    join journal_line l on l.journal_entry_id = d.journal_entry_id join account a on a.id = l.account_id
   where d.company_id = ${C} and d.status = 'POSTED' and d.doc_type in ('CASH_VOUCHER','BANK_VOUCHER') and a.code like '31%'`;
const capLeft = [...capital];
for (const s of sharesSeen) {
  const i = capLeft.findIndex((c) => c.date === s.date && -c.amount === s.amount && c.code === acctOf(s.acct).code);
  if (i < 0) throw new Error(`Shares line ${src(s)} (${s.amount}) is not posted yet — run post-capital-2026.mjs first`);
  capLeft.splice(i, 1);
}

console.log(`lines ${lines.length}: receipts ${pays.filter((p) => p.side === "AR").length}, supplier payments ${pays.filter((p) => p.side === "AP").length} (6 from journals), `
  + `transfers ${transfers.length}, courier ${courier.length}, vouchers ${vouchers.length}, shares already posted ${sharesSeen.length}`);

// ------------------------------------------------------------- posting --
const [done] = await sql`select count(*)::int n from document where company_id = ${C} and doc_type in ('CUSTOMER_RECEIPT','SUPPLIER_PAYMENT','CASH_TRANSFER') and doc_date between '2026-01-01' and '2026-01-31' and status = 'POSTED'`;
if (done.n > 0) throw new Error(`${done.n} January receipts, payments or transfers are already posted — this has run before.`);

const DRY = new Error("dry run");
const report: string[] = [];
try {
  await sql.begin(async (tx) => {
    // Invoices still open, per partner, oldest first.
    const open = await tx`
      select o.document_id as id, o.doc_no, d.source_ref, o.partner_id, o.posting_date::text as date, o.outstanding::float as left, d.currency, d.location_id
        from v_open_item o join document d on d.id = o.document_id
       where o.company_id = ${C} and o.doc_type in ('SALES_INVOICE','PURCHASE_INVOICE')
       order by o.posting_date, d.source_ref nulls last, o.doc_no`;
    if (open.some((o) => o.currency !== "MMK")) throw new Error("An open invoice is not in kyat");
    const advances = new Map<string, { id: string; left: number }[]>();
    const dates = [...new Set([...pays.map((p) => p.date), ...open.map((o) => o.date)])].sort();
    const touched = [...new Set(pays.map((p) => p.partnerId))];

    for (const date of dates) {
      // Advances already on account go to the invoices of the day first.
      for (const pid of touched) {
        const adv = advances.get(pid) ?? [];
        for (const inv of open.filter((o) => o.partner_id === pid && o.date === date && o.left > 0)) {
          const use: { paymentId: string; amount: number }[] = [];
          for (const a of adv) { if (inv.left <= 0) break; const x = Math.min(a.left, inv.left); if (x <= 0) continue; use.push({ paymentId: a.id, amount: x }); a.left -= x; inv.left -= x; }
          if (use.length) { await applyAdvance({ companyId: C, invoiceId: inv.id, allocations: use, docDate: date }, tx); report.push(`${date} advance → ${inv.source_ref ?? inv.doc_no} ${use.reduce((t, u) => t + u.amount, 0).toLocaleString()}`); }
        }
      }
      for (const p of pays.filter((x) => x.date === date)) {
        const mine = open.filter((o) => o.partner_id === p.partnerId && o.date <= date && o.left > 0);
        const refInv = p.ref ? mine.find((o) => o.source_ref && p.ref!.startsWith(o.source_ref + "/")) : undefined;
        const order = refInv ? [refInv, ...mine.filter((o) => o !== refInv)] : mine;
        let left = p.amount; const alloc: { invoiceId: string; amount: number }[] = [];
        for (const o of order) { if (left <= 0) break; const x = Math.min(o.left, left); alloc.push({ invoiceId: o.id, amount: x }); o.left -= x; left -= x; }
        const base = { companyId: C, partnerId: p.partnerId, docDate: date, cashAccountId: p.moneyId, memo: p.memo, reference: p.ref };
        const post = p.side === "AR" ? postCustomerReceipt : postSupplierPayment;
        if (alloc.length) await post({ ...base, allocations: alloc }, tx);
        if (left > 0.00001) {
          const loc = (open.find((o) => o.partner_id === p.partnerId)?.location_id ?? ho.id) as string;
          const r = await post({ ...base, allocations: [], advance: left, locationId: loc }, tx);
          (advances.get(p.partnerId) ?? advances.set(p.partnerId, []).get(p.partnerId)!).push({ id: r.id, left });
          report.push(`${date} ${p.side} ${p.name} ${p.src}: ${left.toLocaleString()} on account (advance)`);
        }
      }
    }
    for (const t of transfers) await postCashTransfer({ companyId: C, docDate: t.date, fromAccountId: t.from, toAccountId: t.to, fromLocationId: ho.id, toLocationId: ho.id, amount: t.amount, memo: t.memo, reference: t.ref }, tx);
    for (const v of vouchers) await (v.kind === "CASH" ? postCashVoucher : postBankVoucher)({ companyId: C, docDate: v.date, memo: v.memo, reference: v.ref, locationId: ho.id, lines: v.lines }, tx);
    for (const [pid, adv] of advances) for (const a of adv) if (a.left > 0.00001) report.push(`left on account: ${partners.find((p) => p.id === pid)!.name} ${a.left.toLocaleString()}`);
    if (dry) {
      await checks(tx);
      throw DRY;
    }
  });
} catch (e) { if (e !== DRY) throw e; }

// The courier, after: payCourier opens its own transaction.
if (!dry) {
  const [cour] = await sql`select id from business_partner where company_id = ${C} and code = 'COURIER'`;
  for (const c of courier) {
    const charges = await sql`
      select ch.id, ch.base_amount::float - coalesce((select sum(s.amount) from courier_settlement s join document p on p.id = s.payment_id and p.status = 'POSTED' where s.charge_id = ch.id), 0)::float as open, lc.doc_date::text as date
        from landed_cost_charge ch join document lc on lc.id = ch.landed_cost_id
       where ch.partner_id = ${cour.id} and lc.status = 'POSTED' and ch.is_active order by lc.doc_date, lc.doc_no`;
    let left = c.amount; const alloc: { chargeId: string; amount: number }[] = [];
    for (const ch of charges) { if (left <= 0) break; const x = Math.min(ch.open, left); if (x <= 0) continue; alloc.push({ chargeId: ch.id, amount: x }); left -= x;
      if (ch.date > c.date) report.push(`courier ${c.src}: ${x.toLocaleString()} paid ahead of a charge dated ${ch.date}`); }
    if (left > 0.00001) throw new Error(`Courier payment ${c.src}: ${left} more than is owed`);
    await payCourier({ companyId: C, partnerId: cour.id, docDate: c.date, locationId: ho.id, moneyAccountId: c.moneyId, reference: c.ref, memo: c.memo, allocations: alloc });
  }
  await checks(sql);
}
console.log(report.join("\n"));
await sql.end(); process.exit(0);

// -------------------------------------------------------------- checks --
async function checks(db: any) {
  const closing: Record<string, number> = { "1110": 0, "1120": 54360, "1121": 39022.63, "1122": 56593.13, "1123": 119021.12, "1125": 153496874 };
  const bal = await db`select a.code, coalesce(sum(l.base_amount), 0)::float as b from account a left join journal_line l on l.account_id = a.id
    where a.company_id = ${C} and a.code = any(${Object.keys(closing)}) group by 1 order by 1`;
  console.log("\nmoney accounts (DEV vs old closing)" + (dry ? " — courier 15,000,000 out of KBZ not in a dry run" : ""));
  for (const r of bal) console.log(`  ${r.code} ${r.b.toFixed(2).padStart(16)} ${closing[r.code].toFixed(2).padStart(16)} ${Math.abs(r.b - closing[r.code]) < 0.005 ? "ok" : "DIFF " + (r.b - closing[r.code]).toFixed(2)}`);
  for (const [side, old, ctl, adv] of [["AR", oldAR, "1210", "2210"], ["AP", oldAP, "2110", "1520"]] as const) {
    const rows = await db`
      select p.name, coalesce(sum(l.base_amount) filter (where a.code = ${ctl}), 0)::float as owed,
             coalesce(sum(l.base_amount) filter (where a.code = ${adv}), 0)::float as adv
        from journal_line l join account a on a.id = l.account_id join business_partner p on p.id = l.partner_id
       where a.company_id = ${C} and a.code in (${ctl}, ${adv}) group by 1`;
    const mine = new Map(rows.map((r: any) => [r.name, side === "AR" ? r.owed + r.adv : -(r.owed + r.adv)]));
    let bad = 0, tot = 0, totOld = 0;
    for (const [name, b] of old) {
      const p = partnerOf(name, side); const m = (mine.get(p.name) as number) ?? 0; tot += m; totOld += b;
      if (Math.abs(m - b) > 0.005) { bad++; console.log(`  ${side} ${name}: DEV ${m.toLocaleString()} old ${b.toLocaleString()}`); }
    }
    console.log(`${side}: ${old.size} partners, ${bad} differ; DEV ${tot.toLocaleString()} old ${totOld.toLocaleString()}`);
  }
}
