// A number wider than its series' padding is printed in full, and only a
// genuine repeat of a submission is called one.
//
//   ./node_modules/.bin/tsx scripts/test-numbering.mjs
//
// Found by load testing: series are padded to three digits and lpad() cut the
// thousandth number down to the hundredth's, so on a busy day every posting
// after the 999th journal entry failed. And postOnce reported that failure —
// a clashing document number — as "already being posted", because it took
// every unique violation for its own.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

import { takeTestLock, releaseTestLock } from "./test-lock.mjs";
import { resetTransactions } from "./test-reset.mjs";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
if (!process.env.DATABASE_URL && existsSync(join(root, ".env"))) {
  for (const line of readFileSync(join(root, ".env"), "utf8").split("\n")) {
    const m = line.match(/^\s*DATABASE_URL\s*=\s*(.+?)\s*$/);
    if (m) { process.env.DATABASE_URL = m[1].replace(/^["']|["']$/g, ""); break; }
  }
}
const url = process.env.DATABASE_URL;
const sql = postgres(url, { ssl: url.includes("localhost") ? false : "require",
  prepare: !url.includes("-pooler."), onnotice: () => {}, max: 4 });

await takeTestLock(sql, "test-numbering.mjs");
const P = await import("../lib/posting.ts");
const { postOnce } = await import("../lib/idempotency.ts");

let bad = 0;
const check = (label, ok, detail = "") => {
  if (!ok) bad++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
};
const tail = (no) => String(no).replace(/^[A-Z]+\d{8}/, "");
class Rollback extends Error {}
/** Run inside a transaction that is always rolled back: leaves no trace. */
const scratch = async (fn) => {
  let out;
  try { await sql.begin(async (tx) => { out = await fn(tx); throw new Rollback(); }); }
  catch (e) { if (!(e instanceof Rollback)) throw e; }
  return out;
};

// Every type numbered through fn_next_document_no: each document type, plus
// the journal and the two non-document series that use it.
const TYPES = [
  "PURCHASE_ORDER", "GOODS_RECEIPT", "PURCHASE_INVOICE", "PURCHASE_RETURN", "SUPPLIER_PAYMENT",
  "SALES_ORDER", "DELIVERY", "SALES_INVOICE", "SALES_RETURN", "CUSTOMER_RECEIPT",
  "STOCK_ADJUSTMENT", "STOCK_TRANSFER", "CASH_VOUCHER", "BANK_VOUCHER", "JOURNAL_VOUCHER",
  "CASH_TRANSFER", "OPENING_BALANCE", "CONSIGNMENT_RECEIPT", "CONSIGNMENT_SETTLEMENT",
  "ADVANCE_APPLICATION", "CREDIT_NOTE", "DEBIT_NOTE", "YEAR_END_CLOSE",
  "JOURNAL", "BANK_STATEMENT", "DELIVERY_TRIP",
];
const DAY = "2099-12-31"; // a day nothing real is numbered on

try {
  const [co] = await sql`select id, name from company order by created_at limit 1`;
  console.log(`\n  ${co.name}\n`);

  // ---- the padding itself --------------------------------------------------
  console.log("  padding is a minimum width, never a maximum\n");
  for (const [v, want] of [["1", "001"], ["999", "999"], ["1000", "1000"], ["10000", "10000"]]) {
    const [r] = await sql`select fn_pad_document_no(${v}, 3) as p`;
    check(`${v} → ${want}`, r.p === want, r.p);
  }

  // ---- 998, 999, 1000, 1001 for every type ------------------------------
  console.log("\n  each series runs 998, 999, 1000, 1001 without a clash\n");
  const seed = (tx, type, next) => tx`
    insert into number_series (company_id, document_type, series_date, prefix, padding, next_value)
    values (${co.id}, fn_document_prefix(${type}, null), ${DAY}::date, fn_document_prefix(${type}, null), 3, ${next})
    on conflict (company_id, document_type, series_date) where series_date is not null
    do update set next_value = excluded.next_value, padding = 3`;
  for (const type of TYPES) {
    const got = await scratch(async (tx) => {
      await seed(tx, type, 998);
      const out = [];
      for (let i = 0; i < 4; i++) out.push((await tx`select fn_next_document_no(${co.id}, ${type}, ${DAY}::date) as n`)[0].n);
      return out;
    });
    const tails = got.map(tail);
    check(`${type}`, tails.join(",") === "998,999,1000,1001" && new Set(got).size === 4, got.join(" "));
  }

  // The preview the forms show is the same number.
  const peek = await scratch(async (tx) => {
    await seed(tx, "SALES_INVOICE", 1000);
    return (await tx`select fn_peek_document_no(${co.id}, 'SALES_INVOICE', ${DAY}::date) as n`)[0].n;
  });
  check("the next-number preview shows 1000 in full", tail(peek) === "1000", peek);

  // ---- real postings across the boundary ---------------------------------
  console.log("\n  postings cross the 999th journal entry and receipt of the day\n");
  await resetTransactions(sql);
  const today = new Date().toISOString().slice(0, 10);
  const [loc] = await sql`select id from location where company_id = ${co.id} and is_stock_location and is_active order by code limit 1`;
  const [item] = await sql`select id from item where company_id = ${co.id} and is_stocked and is_active and not tracks_serial
     and not tracks_batch and not exists (select 1 from item c where c.parent_item_id = item.id) order by code limit 1`;
  const [supp] = await sql`select id from business_partner where company_id = ${co.id} and is_supplier order by code limit 1`;
  for (const type of ["JOURNAL", "GOODS_RECEIPT"]) {
    await sql`
      insert into number_series (company_id, document_type, series_date, prefix, padding, next_value)
      values (${co.id}, fn_document_prefix(${type}, null), ${today}::date, fn_document_prefix(${type}, null), 3, 998)
      on conflict (company_id, document_type, series_date) where series_date is not null
      do update set next_value = 998, padding = 3`;
  }
  const receipts = [];
  let failed = null;
  for (let i = 0; i < 4; i++) {
    try {
      receipts.push(await postOnce(co.id, `numbering-${i}`, (tx) => P.postGoodsReceipt({
        companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: today,
        lines: [{ itemId: item.id, qty: 1, unitCost: 100 }],
      }, tx)));
    } catch (e) { failed = e; break; }
  }
  check("four receipts post across the boundary", receipts.length === 4, failed ? failed.message : "");
  check("  receipt numbers 998, 999, 1000, 1001", receipts.map((r) => tail(r.docNo)).join(",") === "998,999,1000,1001",
    receipts.map((r) => r.docNo).join(" "));
  const entries = await sql`
    select je.entry_no from journal_entry je join document d on d.journal_entry_id = je.id
     where d.id in ${sql(receipts.map((r) => r.id))} order by je.entry_no`;
  const jeTails = entries.map((e) => tail(e.entry_no)).sort((a, b) => Number(a) - Number(b));
  check("  journal entries 998, 999, 1000, 1001", jeTails.join(",") === "998,999,1000,1001", entries.map((e) => e.entry_no).join(" "));

  // ---- a genuine repeat is still a repeat -------------------------------
  console.log("\n  the same submission, sent again\n");
  const first = receipts[0];
  const again = await postOnce(co.id, "numbering-0", (tx) => P.postGoodsReceipt({
    companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: today,
    lines: [{ itemId: item.id, qty: 1, unitCost: 100 }],
  }, tx));
  check("a resent submission is handed the first document", again.id === first.id && again.repeated === true, again.docNo);

  const both = await Promise.allSettled([0, 1].map(() => postOnce(co.id, "numbering-race", (tx) => P.postGoodsReceipt({
    companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: today,
    lines: [{ itemId: item.id, qty: 1, unitCost: 100 }],
  }, tx))));
  const [{ n: raced }] = await sql`select count(*)::int n from posting_attempt where company_id = ${co.id} and key = 'numbering-race' and document_id is not null`;
  const outcomes = both.map((b) => b.status === "fulfilled" ? (b.value.repeated ? "repeat" : "posted") : b.reason.message);
  check("two at once: one document, the other a repeat or a wait",
    raced === 1 && outcomes.filter((o) => o === "posted").length === 1
      && outcomes.every((o) => o === "posted" || o === "repeat" || /already being posted/.test(o)),
    outcomes.join(" | "));

  // ---- any other unique violation keeps its own cause --------------------
  console.log("\n  an unrelated unique violation\n");
  let caught = null;
  try {
    await postOnce(co.id, "numbering-unrelated", async (tx) => {
      // Two series rows for the same day: number_series_day_uq refuses the second.
      await tx`insert into number_series (company_id, document_type, series_date, prefix, padding, next_value)
               values (${co.id}, 'ZZTEST', ${DAY}::date, 'ZZ', 3, 1)`;
      await tx`insert into number_series (company_id, document_type, series_date, prefix, padding, next_value)
               values (${co.id}, 'ZZTEST', ${DAY}::date, 'ZZ', 3, 1)`;
      return { id: "never", docNo: "never" };
    });
  } catch (e) { caught = e; }
  check("the real error reaches the caller", caught?.code === "23505" && caught?.constraint_name !== "posting_attempt_pkey",
    caught ? `${caught.code} ${caught.constraint_name ?? ""}` : "nothing thrown");
  check("  not reported as a double submission", caught && !/already being posted/.test(caught.message), caught?.message);
  const [left] = await sql`select count(*)::int n from posting_attempt where company_id = ${co.id} and key = 'numbering-unrelated'`;
  check("  and the key is free to try again", left.n === 0, `${left.n} rows held`);
} catch (e) {
  bad++;
  console.error("\n  CRASH", e);
} finally {
  await sql`delete from number_series where series_date = '2099-12-31'`;
  await resetTransactions(sql).catch(() => {});
  await releaseTestLock(sql).catch(() => {});
  await sql.end();
}
console.log(bad ? `\n  ${bad} FAILED\n` : "\n  all passed\n");
process.exit(bad ? 1 : 0);
