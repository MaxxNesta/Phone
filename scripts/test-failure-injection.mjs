// A posting that fails part-way leaves nothing behind.
//
//   ./node_modules/.bin/tsx scripts/test-failure-injection.mjs
//
// Every statement of a posting is made to fail in turn — the first, then the
// second, and so on until the posting gets through untouched — and after each
// failure the books must be exactly as they were: no document, journal line,
// stock movement, IMEI event or used document number left behind. Then a
// posting's connection is killed mid-way, which is what a crashed function or
// a dropped network does, with the same check.
//
// Covered: a goods receipt with IMEIs, a counter sale paid in cash (invoice,
// stock out, IMEI sold, receipt, journal) and the void of that sale.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { takeTestLock, releaseTestLock } from "./test-lock.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
if (!process.env.DATABASE_URL && existsSync(join(root, ".env"))) {
  for (const line of readFileSync(join(root, ".env"), "utf8").split("\n")) {
    const m = line.match(/^\s*DATABASE_URL\s*=\s*(.+?)\s*$/);
    if (m) { process.env.DATABASE_URL = m[1].replace(/^["']|["']$/g, ""); break; }
  }
}
const url = process.env.DATABASE_URL;
const opts = { ssl: url.includes("localhost") ? false : "require", prepare: !url.includes("-pooler."), onnotice: () => {} };
const sql = postgres(url, { ...opts, max: 4 });
await takeTestLock(sql, "test-failure-injection.mjs");
const P = await import("../lib/posting.ts");

let bad = 0;
const check = (label, ok, detail = "") => {
  if (!ok) bad++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
};

/**
 * The transaction, failing on its nth statement. Only tagged-template calls
 * are statements; tx(rows) and tx(name) build fragments and pass through.
 */
class Injected extends Error {}
function failingAt(tx, n) {
  let i = 0;
  const wrap = (t) => new Proxy(t, {
    apply(target, self, args) {
      const isStatement = Array.isArray(args[0]) && "raw" in args[0];
      if (isStatement && ++i === n) throw new Injected(`injected at statement ${n}`);
      return Reflect.apply(target, self, args);
    },
    get(target, prop) {
      // A savepoint hands its callback a transaction of its own: fail there too.
      if (prop === "savepoint") return (fn) => target.savepoint((sp) => fn(wrap(sp)));
      return Reflect.get(target, prop);
    },
  });
  return { tx: wrap(tx), count: () => i };
}

/** Everything a posting can leave behind, for this company. */
async function state(companyId) {
  const [s] = await sql`
    select (select count(*) from document where company_id = ${companyId})::int as documents,
           (select count(*) from journal_entry where company_id = ${companyId})::int as entries,
           (select count(*) from journal_line where company_id = ${companyId})::int as lines,
           (select count(*) from stock_movement where company_id = ${companyId})::int as movements,
           (select count(*) from stock_lot where company_id = ${companyId})::int as lots,
           (select count(*) from stock_serial where company_id = ${companyId})::int as serials,
           (select count(*) from stock_serial_event where company_id = ${companyId})::int as serial_events,
           (select count(*) from stock_lot_consumption where company_id = ${companyId})::int as consumptions,
           (select count(*) from posting_attempt where company_id = ${companyId})::int as attempts,
           (select coalesce(sum(next_value), 0) from number_series where company_id = ${companyId})::int as numbers_used,
           (select count(*) from number_series where company_id = ${companyId})::int as number_series`;
  return s;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const diff = (a, b) => Object.keys(a).filter((k) => a[k] !== b[k]).map((k) => `${k} ${a[k]}→${b[k]}`).join(", ");

/**
 * Fail the posting at statement 1, 2, 3… until it gets through. Each failure
 * must change nothing. Returns what the clean run posted.
 */
async function everyStatement(label, companyId, post) {
  const before = await state(companyId);
  let n = 1, failures = 0, leaks = [];
  for (;; n++) {
    let f;
    try {
      const r = await sql.begin((tx) => { f = failingAt(tx, n); return post(f.tx); });
      // Got through: n was past its last statement.
      const after = await state(companyId);
      check(`${label}: failed at each of its ${n - 1} statements, then posted`, failures === n - 1, `${failures} failures`);
      check(`  no failure left anything behind`, leaks.length === 0, leaks.slice(0, 3).join(" | "));
      check(`  and the clean run posted`, !same(before, after), r?.docNo ?? "");
      return r;
    } catch (e) {
      if (!(e instanceof Injected)) {
        // A real error raised because of the injected one is still a rollback.
        if (!String(e?.message).includes("injected")) { leaks.push(`n=${n} unexpected: ${e.message}`); }
      }
      failures++;
      const now = await state(companyId);
      if (!same(before, now)) leaks.push(`n=${n}: ${diff(before, now)}`);
      if (n > 400) { check(`${label}: still failing at statement 400`, false); return null; }
    }
  }
}

/** Kill the posting's own connection once it is part-way through. */
async function killedMidway(label, companyId, post, atStatement) {
  const before = await state(companyId);
  const own = postgres(url, { ...opts, max: 1 });
  let error = null;
  try {
    await own.begin(async (tx) => {
      const [{ pid }] = await tx`select pg_backend_pid() as pid`;
      let i = 0;
      const killer = new Proxy(tx, {
        apply(target, self, args) {
          if (Array.isArray(args[0]) && "raw" in args[0] && ++i === atStatement) {
            // From outside, as a crash or a dropped link would: this connection is gone.
            return sql`select pg_terminate_backend(${pid})`.then(() => Reflect.apply(target, self, args));
          }
          return Reflect.apply(target, self, args);
        },
      });
      return post(killer);
    });
  } catch (e) { error = e; }
  await own.end({ timeout: 1 }).catch(() => {});
  const after = await state(companyId);
  check(`${label}: connection killed at statement ${atStatement}`, !!error, error ? String(error.code ?? error.message).slice(0, 40) : "it committed");
  check(`  nothing left behind`, same(before, after), diff(before, after));
}

try {
  const [co] = await sql`select id, name from company order by created_at limit 1`;
  const [loc] = await sql`select id from location where company_id = ${co.id} and is_stock_location and is_active order by code limit 1`;
  const [supp] = await sql`select id from business_partner where company_id = ${co.id} and is_supplier and is_active order by code limit 1`;
  const [cust] = await sql`select id from business_partner where company_id = ${co.id} and is_customer and is_active order by code limit 1`;
  const [cash] = await sql`select id from account where company_id = ${co.id} and code = '1000'`;
  const [grp] = await sql`select id from item_group where company_id = ${co.id} order by code limit 1`;
  const [uom] = await sql`select id from uom where company_id = ${co.id} order by code limit 1`;
  const today = new Date().toISOString().slice(0, 10);
  const tag = Date.now().toString(36).toUpperCase();
  console.log(`\n  ${co.name}\n`);

  const [phone] = await sql`
    insert into item (company_id, item_group_id, serial, name, base_uom_id, is_stocked, tracks_serial, identity)
    values (${co.id}, ${grp.id}, ${"FI" + tag}, ${"Failure injection phone " + tag}, ${uom.id}, true, true, 'IMEI') returning id`;
  const luhn = (body) => {
    let sum = 0;
    for (let i = 0; i < 14; i++) { let d = Number(body[13 - i]); if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9; } sum += d; }
    return body + ((10 - (sum % 10)) % 10);
  };
  const stamp = String(Date.now()).slice(-7);
  const imeis = Array.from({ length: 4 }, (_, i) => luhn("87" + stamp + String(i).padStart(5, "0")));

  console.log("  a goods receipt of IMEI phones\n");
  const gr = await everyStatement("goods receipt", co.id, (tx) => P.postGoodsReceipt({
    companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: today,
    lines: [{ itemId: phone.id, qty: 4, unitCost: 1000, serials: imeis }],
  }, tx));

  console.log("\n  a counter sale paid in cash\n");
  const sale = (imei) => (tx) => P.postRetailSale({
    companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today, dueDate: today,
    paymentType: "CASH", lines: [{ itemId: phone.id, qty: 1, unitPrice: 1500, serials: [imei] }],
    cashIn: 1500, cashAccountId: cash.id,
  }, tx);
  const sold = await everyStatement("counter sale", co.id, sale(imeis[0]));
  const [still] = await sql`select count(*)::int n from stock_serial ss join stock_serial_event e on e.serial_id = ss.id
                             where ss.serial_no = ${imeis[0]} and e.event = 'SOLD'`;
  check("  the phone was sold once, by the clean run only", still.n === 1, String(still.n));

  console.log("\n  the void of that sale\n");
  if (sold) await everyStatement("void", co.id, (tx) => P.voidDocument({ documentId: sold.id, reason: "failure injection", goodsBack: true }, tx));

  console.log("\n  a connection killed mid-posting\n");
  for (const at of [3, 8, 15]) await killedMidway("counter sale", co.id, sale(imeis[1]), at);
  const after = await sql.begin((tx) => sale(imeis[1])(tx));
  check("after the killed attempts the same sale posts normally", !!after?.id, after?.docNo);

  console.log("\n  the books after all of it\n");
  const [unbalanced] = await sql`
    select count(*)::int n from (select journal_entry_id from journal_line where company_id = ${co.id}
      group by journal_entry_id having abs(sum(base_amount)) > 0.005) x`;
  check("every journal entry balances", unbalanced.n === 0, String(unbalanced.n));
  const [orphans] = await sql`
    select (select count(*) from document d where d.company_id = ${co.id} and d.status = 'POSTED'
              and d.journal_entry_id is null and d.doc_type in ('GOODS_RECEIPT','SALES_INVOICE','CUSTOMER_RECEIPT'))::int as no_journal,
           (select count(*) from stock_movement m where m.company_id = ${co.id}
              and not exists (select 1 from document d where d.id = m.document_id))::int as stray_moves`;
  check("no posted document without its journal", orphans.no_journal === 0, String(orphans.no_journal));
  check("no stock movement without its document", orphans.stray_moves === 0, String(orphans.stray_moves));
  const [onHand] = await sql`select coalesce(sum(qty_on_hand), 0)::int q from v_stock_on_hand where item_id = ${phone.id}`;
  check("stock adds up: 4 received, 1 sold and voided back, 1 sold", onHand.q === 3, String(onHand.q));
  await sql`update item set is_active = false where id = ${phone.id}`;
} catch (e) {
  bad++;
  console.error("\n  CRASH", e);
} finally {
  await releaseTestLock(sql).catch(() => {});
  await sql.end();
}
console.log(bad ? `\n  ${bad} FAILED\n` : "\n  all passed\n");
process.exit(bad ? 1 : 0);
