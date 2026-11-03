// Posting imported purchase invoices as real bills.
//
//   npx tsx scripts/test-purchase-import-post.mjs
//
// Every invoice goes through postPurchaseWithReceipt, the engine behind a bill
// typed in with "goods arriving with this bill". These checks are about what
// that leaves behind — the goods receipt, stock dated to the bill, units,
// payable, any payment, journals — and about what must never happen: a bill
// posted twice, half an invoice left behind, a preview that keeps anything.
//
// Writes documents, then empties the transaction tables. Master data is never touched.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
if (!process.env.DATABASE_URL && existsSync(join(root, ".env"))) {
  for (const line of readFileSync(join(root, ".env"), "utf8").split("\n")) {
    const m = line.match(/^\s*DATABASE_URL\s*=\s*(.+?)\s*$/);
    if (m) { process.env.DATABASE_URL = m[1].replace(/^["']|["']$/g, ""); break; }
  }
}

const { sql } = await import("../lib/db.ts");
const { takeTestLock, releaseTestLock } = await import("./test-lock.mjs");
const { resetTransactions } = await import("./test-reset.mjs");
const { parsePurchaseReport, planPurchaseImport, invoiceStatus } = await import("../lib/import-purchase-invoices.ts");
const { getPurchaseImportMaster, postImportedPurchases, previewPurchasePosting } = await import("../lib/purchase-import.ts");
const { postPurchaseWithReceipt } = await import("../lib/posting.ts");

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
};

await takeTestLock(sql, "test-purchase-import-post.mjs");
try {
  await resetTransactions(sql);
  const [co] = await sql`select id, name from company order by created_at limit 1`;
  console.log(`\n  ${co.name}\n`);
  const leaf = async (identity) => (await sql`
    select code from item i where company_id = ${co.id} and is_active and identity = ${identity} and is_stocked
       and not exists (select 1 from item c where c.parent_item_id = i.id) order by code limit 1`)[0].code;
  const IMEI = await leaf("IMEI"), OPT = await leaf("OPTIONAL"), NONE = await leaf("NONE");
  const [cash] = await sql`select id from account where company_id = ${co.id} and code = '13101'`;
  const [wh] = await sql`select id, name from location where company_id = ${co.id} and is_stock_location and is_active order by name limit 1`;

  // Real-shaped IMEIs: fourteen digits and their check digit, so none is flagged as a typo.
  let body = 35693803564380n;
  const next = () => {
    const s = String(body++);
    let sum = 0;
    for (let i = 0; i < 14; i++) { let d = Number(s[13 - i]); if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9; } sum += d; }
    return s + ((10 - (sum % 10)) % 10);
  };
  /** One invoice block of the report. */
  const bill = (ref, date, lines, extra = []) => [
    ["Docid", ref, "Date", date], ["Supplier", "China", "Payment", "Credit"], ["Location", wh.name],
    ["Code", "Description", "Qty", "Pur.price", "Amount"],
    ...lines.flatMap(([code, qty, price, serials]) => [[code, "x", String(qty), String(price), String(qty * price)], ...(serials?.length ? [["", serials.join(", ")]] : [])]),
    ["Invoice Total", String(lines.reduce((a, l) => a + l[1], 0)), String(lines.reduce((a, l) => a + l[1] * l[2], 0))],
    ...extra,
  ];
  const plan = async (rows, mapping = { suppliers: {}, locations: {} }) => {
    const src = parsePurchaseReport(rows);
    const master = await getPurchaseImportMaster(co.id, { refs: src.map((s) => s.oldRef), serials: src.flatMap((s) => s.lines.flatMap((l) => l.serials)) });
    return { plan: planPurchaseImport(src, master, mapping), master, mapping };
  };
  const docsFor = (ref) => sql`select doc_type, doc_no, gross_total::float as total, doc_date::text as date, source_document_id
    from document where company_id = ${co.id} and source_ref = ${ref} order by doc_type`;
  const owing = async (docNo) => Number((await sql`select outstanding from v_invoice_status where doc_no = ${docNo}`)[0]?.outstanding ?? NaN);

  console.log("  Credit: a bill with its receipt\n");
  const s1 = [next(), next()];
  let a = await plan(bill("t-credit", "02/01/2026", [[IMEI, 2, 1_000_000, s1]]));
  check("planned ready", invoiceStatus(a.plan[0], a.mapping) === "ready", JSON.stringify(a.plan[0].issues));

  // The preview posts and rolls back: nothing — not even a number — is kept.
  const pv = await previewPurchasePosting(co.id, a.plan[0], a.mapping, a.master);
  check("preview lists PI and GR", !("error" in pv) && pv.documents.map((d) => d.type).sort().join() === "GOODS_RECEIPT,PURCHASE_INVOICE", JSON.stringify(pv));
  const dr = pv.journal?.reduce((x, j) => x + j.debit, 0), cr = pv.journal?.reduce((x, j) => x + j.credit, 0);
  check("preview journal balances", dr > 0 && Math.abs(dr - cr) < 0.01, `${dr} / ${cr}`);
  check("preview keeps nothing", (await sql`select count(*)::int as n from document`)[0].n === 0);

  let r = await postImportedPurchases(co.id, a.plan, a.mapping, a.master);
  check("posted", r[0].status === "posted" && r[0].receiptNo, JSON.stringify(r[0]));
  check("its number is the first of the day — the preview took none", r[0].invoiceNo === "DP20260102001", r[0].invoiceNo);
  const d1 = await docsFor("t-credit");
  check("PI and GR both carry the old ID", d1.length === 2 && d1.every((d) => d.date === "2026-01-02"), JSON.stringify(d1));
  check("the bill is owed in full", await owing(r[0].invoiceNo) === 2_000_000);
  const [lot] = await sql`select qty_received::float as q, to_char(received_date at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as at
    from stock_lot sl join item i on i.id = sl.item_id where i.code = ${IMEI}`;
  check("stock arrives on the bill's date, start of day", lot?.q === 2 && lot.at.startsWith("2026-01-0"), JSON.stringify(lot));
  check("both units are in stock", (await sql`select count(*)::int as n from stock_serial where serial_no = any(${s1})`)[0].n === 2);

  // The same bill posted by hand: the same accounts and amounts.
  const [ii] = await sql`select id from item where company_id = ${co.id} and code = ${IMEI}`;
  const [sup] = await sql`select id from business_partner where company_id = ${co.id} and code = '01-001'`;
  const manual = await postPurchaseWithReceipt({ companyId: co.id, partnerId: sup.id, locationId: wh.id, docDate: "2026-01-02", dueDate: "2026-02-01",
    lines: [{ itemId: ii.id, qty: 2, unitPrice: 1_000_000, serials: [next(), next()] }] });
  const shape = async (piId) => (await sql`
    select a.code, sum(jl.base_amount)::float as amt from journal_line jl join account a on a.id = jl.account_id
     where jl.journal_entry_id in (select journal_entry_id from document where id = ${piId} or id = (select source_document_id from document where id = ${piId}))
     group by a.code order by a.code`).map((x) => `${x.code}:${x.amt}`).join(" ");
  const [imp] = await sql`select id from document where doc_no = ${r[0].invoiceNo}`;
  check("journals match the same bill posted by hand", await shape(imp.id) === await shape(manual.id), `${await shape(imp.id)} | ${await shape(manual.id)}`);

  console.log("\n  Paid now, in full and in part\n");
  const pay = { suppliers: {}, locations: {}, payAccount: cash.id };
  a = await plan([...bill("t-cash", "03/01/2026", [[IMEI, 1, 500_000, [next()]]], [["Paid Amount", "", "500000"]]),
                  ...bill("t-part", "03/01/2026", [[IMEI, 1, 800_000, [next()]]], [["Paid Amount", "", "300000"]])], pay);
  r = await postImportedPurchases(co.id, a.plan, pay, a.master);
  check("both posted with a payment each", r.every((x) => x.status === "posted" && x.paymentNo), JSON.stringify(r));
  check("one supplier payment per paid bill, no more",
    (await sql`select count(*)::int as n from document where doc_type = 'SUPPLIER_PAYMENT'`)[0].n === 2);
  check("paid in full owes nothing", await owing(r.find((x) => x.oldRef === "t-cash").invoiceNo) === 0);
  check("paid in part owes the rest", await owing(r.find((x) => x.oldRef === "t-part").invoiceNo) === 500_000);

  console.log("\n  Optional and no serials; a discount\n");
  a = await plan(bill("t-mixed", "04/01/2026", [[OPT, 2, 100_000, []], [NONE, 3, 10_000, ["NOTE1"]]],
    [["Voucher Discount", "", "", "", "", "30000"], ["Net Total", "", "200000"]]));
  // The report's own row shape; the planner reads the first number after the label.
  check("planned", ["ready", "review"].includes(invoiceStatus(a.plan[0], a.mapping)), JSON.stringify(a.plan[0].issues));
  r = await postImportedPurchases(co.id, a.plan, a.mapping, a.master);
  const [mixed] = await sql`select gross_total::float as t, memo from document where doc_no = ${r[0].invoiceNo ?? ""}`;
  check("posted at the discounted total", r[0].status === "posted" && Math.abs(mixed?.t - 200_000) < 1, JSON.stringify({ r: r[0], mixed }));
  check("a serial on a no-serial item stays on the bill as a note", /NOTE1/.test(mixed?.memo ?? ""));
  const [disc] = await sql`select coalesce(sum(-jl.base_amount), 0)::float as d from journal_line jl join account a on a.id = jl.account_id
    where a.code = '51201' and jl.journal_entry_id in (select journal_entry_id from document where doc_no = ${r[0].invoiceNo ?? ""})`;
  check("the discount reaches 51201", Math.abs(disc.d - 30_000) < 1, String(disc.d));

  console.log("\n  A failure rolls back that invoice only; a retry posts nothing twice\n");
  const taken = s1[0];  // already in stock from the first bill
  const src = parsePurchaseReport([...bill("t-ok", "05/01/2026", [[IMEI, 1, 100_000, [next()]]]),
                                   ...bill("t-bad", "05/01/2026", [[IMEI, 1, 100_000, [taken]]])]);
  // A master read before the clash existed: the engine must still refuse.
  const stale = await getPurchaseImportMaster(co.id, { refs: [], serials: [] });
  const sp = planPurchaseImport(src, stale, { suppliers: {}, locations: {} });
  const before = (await sql`select count(*)::int as n from document`)[0].n;
  r = await postImportedPurchases(co.id, sp, { suppliers: {}, locations: {} }, stale);
  check("the good one posts, the bad one fails", r.find((x) => x.oldRef === "t-ok").status === "posted" && r.find((x) => x.oldRef === "t-bad").status === "failed",
    JSON.stringify(r));
  check("nothing of the failed one is left", (await docsFor("t-bad")).length === 0
    && (await sql`select count(*)::int as n from document`)[0].n === before + 2);
  const again = await postImportedPurchases(co.id, sp, { suppliers: {}, locations: {} }, stale);
  check("a retry hands back the posted one", again.find((x) => x.oldRef === "t-ok").status === "already");
  check("and posts nothing new", (await sql`select count(*)::int as n from document`)[0].n === before + 2);

  console.log("\n  Duplicates\n");
  const re = await plan(bill("t-credit", "02/01/2026", [[IMEI, 1, 1, [next()]]]));
  check("a posted old ID is shown as posted", invoiceStatus(re.plan[0], re.mapping) === "imported" && re.plan[0].already.docNo === "DP20260102001");
  // Even with the idempotency claim gone, the database refuses a second bill under the same old ID.
  await sql`delete from posting_attempt where key = 'pi-import:t-credit'`;
  const forced = await postImportedPurchases(co.id, re.plan.map((p) => ({ ...p, already: null })), re.mapping, re.master);
  check("the database refuses a second bill for it", forced[0].status === "failed" && /already posted/.test(forced[0].error), JSON.stringify(forced[0]));
  await sql`insert into historical_purchase_invoice (company_id, invoice_no, old_ref, doc_date, partner_id, location_id, batch_ref)
            values (${co.id}, 'HPI-T-1', 't-history', '2026-01-06', ${sup.id}, ${wh.id}, 'HIMP-T')`;
  const hist = await plan(bill("t-history", "06/01/2026", [[IMEI, 1, 1, [next()]]]));
  check("a history record never becomes a live bill", invoiceStatus(hist.plan[0], hist.mapping) === "imported" && hist.plan[0].already.kind === "HISTORY");
} finally {
  await resetTransactions(sql);
  await releaseTestLock(sql);
  await sql.end();
}
console.log(failures ? `\n  ${failures} FAILED\n` : "\n  all passed\n");
process.exit(failures ? 1 : 0);
