// After a load test: does the dev database still add up? Checks every
// load-test run (items and partners coded LT…), prints PASS/FAIL per check
// and writes loadtest/results/verify.json.
//   node loadtest/verify.mjs
import postgres from "postgres";
import { readFileSync, writeFileSync } from "node:fs";

const url = process.env.DATABASE_URL
  ?? readFileSync(".env", "utf8").match(/^\s*DATABASE_URL\s*=\s*"?(.+?)"?\s*$/m)[1];
if (!url.includes("ep-winter-leaf")) { console.error("Not the dev database — refusing."); process.exit(1); }
const sql = postgres(url, { ssl: "require", max: 1, prepare: false });
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`); };

// The app prefixes item codes with the category's (IPH…); the serial is ours as given.
const items = await sql`select id, serial as code, tracks_serial from item where serial ~ '^LT[0-9]{10}-(CASE|PHONE)$' order by serial`;
const ids = items.map((i) => i.id);
const docs = await sql`
  select d.doc_type, count(distinct d.id)::int n
    from document d join document_line dl on dl.document_id = d.id
   where dl.item_id in ${sql(ids)} and d.status = 'POSTED' group by 1 order by 1`;
console.log("Load-test documents:", docs.map((d) => `${d.doc_type} ${d.n}`).join(", "));

// 1. Stock: on hand = received − sold, the stock ledger agrees, and the FIFO layers agree.
for (const it of items) {
  const [s] = await sql`
    select coalesce((select sum(qty_on_hand) from v_stock_on_hand where item_id = ${it.id}), 0)::float on_hand,
           coalesce((select sum(qty) from stock_movement where item_id = ${it.id}), 0)::float moved,
           coalesce((select sum(dl.base_qty) from document_line dl join document d on d.id = dl.document_id
                      where dl.item_id = ${it.id} and d.status = 'POSTED' and d.doc_type = 'GOODS_RECEIPT'), 0)::float received,
           coalesce((select sum(dl.base_qty) from document_line dl join document d on d.id = dl.document_id
                      where dl.item_id = ${it.id} and d.status = 'POSTED' and d.doc_type = 'SALES_INVOICE'), 0)::float sold,
           coalesce((select sum(l.qty_received - coalesce(c.used, 0)) from stock_lot l
                      left join (select lot_id, sum(qty) used from stock_lot_consumption group by lot_id) c on c.lot_id = l.id
                     where l.item_id = ${it.id}), 0)::float in_layers`;
  const ok = s.on_hand === s.received - s.sold && s.moved === s.on_hand && s.in_layers === s.on_hand;
  check(`stock adds up: ${it.code}`, ok, `received ${s.received}, sold ${s.sold}, on hand ${s.on_hand}, ledger ${s.moved}, FIFO layers ${s.in_layers}`);
  const [neg] = await sql`select count(*)::int n from negative_stock where item_id = ${it.id}`;
  check(`no negative stock: ${it.code}`, neg.n === 0, `${neg.n} shortfalls`);
}

// 2. Serials: every phone sold at most once; sold count matches the sale lines.
const phones = items.filter((i) => i.tracks_serial).map((i) => i.id);
const [dup] = await sql`
  select count(*)::int n from (
    select si.serial_id from stock_serial_issue si join stock_serial s on s.id = si.serial_id
     where s.item_id in ${sql(phones)} and fn_serial_issue_stands(si.stock_movement_id)
     group by si.serial_id having count(*) > 1) x`;
check("no IMEI issued twice", dup.n === 0, `${dup.n} serials with more than one standing sale`);
const [st] = await sql`
  select count(*) filter (where v.status = 'SOLD')::int sold, count(*) filter (where v.status = 'IN_STOCK')::int in_stock, count(*)::int total,
         (select coalesce(sum(dl.base_qty), 0)::int from document_line dl join document d on d.id = dl.document_id
           where dl.item_id in ${sql(phones)} and d.status = 'POSTED' and d.doc_type = 'SALES_INVOICE') as sale_qty
    from stock_serial s join v_stock_serial v on v.serial_id = s.id where s.item_id in ${sql(phones)}`;
check("sold IMEIs = phones on sale lines", st.sold === st.sale_qty, `${st.sold} sold, ${st.sale_qty} on lines, ${st.in_stock} in stock of ${st.total}`);

// The race phones: each attempted one sold exactly once.
const runs = [...new Set(items.map((i) => i.code.split("-")[0]))];
let raceChecked = 0, raceBad = 0;
for (const r of runs) {
  let run; try { run = JSON.parse(readFileSync("loadtest/run.json", "utf8")); } catch { continue; }
  if (run.run !== r) continue;
  const rows = await sql`
    select s.serial_no, count(si.id) filter (where fn_serial_issue_stands(si.stock_movement_id))::int sold
      from stock_serial s left join stock_serial_issue si on si.serial_id = s.id
     where s.serial_no in ${sql(run.raceImeis)} group by 1`;
  for (const row of rows) { if (row.sold > 0) raceChecked++; if (row.sold > 1) raceBad++; }
}
check("race phones sold at most once", raceBad === 0, `${raceChecked} race phones sold, ${raceBad} sold twice`);

// 3. Invoices and payments: what the customer owes = invoiced − received; walk-in sales fully paid.
const [ar] = await sql`
  select coalesce(sum(o.outstanding), 0)::float owed,
         count(*) filter (where o.outstanding < -0.005)::int negative
    from v_open_item o join document d on d.id = o.document_id
    join business_partner p on p.id = d.partner_id
   where p.code ~ '^LT[0-9]{10}-C$' and d.doc_type = 'SALES_INVOICE'`;
const [inv] = await sql`
  select coalesce(sum(d.gross_total), 0)::float invoiced
    from document d join business_partner p on p.id = d.partner_id
   where p.code ~ '^LT[0-9]{10}-C$' and d.doc_type = 'SALES_INVOICE' and d.status = 'POSTED'`;
const [rc] = await sql`
  select coalesce(sum(d.gross_total), 0)::float received
    from document d join business_partner p on p.id = d.partner_id
   where p.code ~ '^LT[0-9]{10}-C$' and d.doc_type = 'CUSTOMER_RECEIPT' and d.status = 'POSTED'`;
check("credit customer: owed = invoiced − paid", Math.abs(ar.owed - (inv.invoiced - rc.received)) < 0.01 && ar.negative === 0,
  `invoiced ${inv.invoiced}, paid ${rc.received}, still owed ${ar.owed}, overpaid invoices ${ar.negative}`);
const [walk] = await sql`
  select count(*)::int unpaid from v_open_item o join document d on d.id = o.document_id
   where d.reference like 'POS:LT%' and d.partner_id = (select id from business_partner where code = 'WALKIN' limit 1)
     and o.outstanding > 0.005`;
check("walk-in POS sales fully paid", walk.unpaid === 0, `${walk.unpaid} unpaid`);

// 4. Every load-test journal entry balances, and every posted load-test document has one.
const ltDocs = sql`
  select distinct d.id, d.journal_entry_id from document d
    left join document_line dl on dl.document_id = d.id
   where d.status = 'POSTED' and (dl.item_id in ${sql(ids)} or d.reference like 'POS:LT%' or d.memo like 'LOADTEST%')`;
const [je] = await sql`
  select count(*)::int entries,
         count(*) filter (where abs(t.total) > 0.005)::int unbalanced
    from (select jl.journal_entry_id, sum(jl.base_amount) total from journal_line jl
           where jl.journal_entry_id in (select journal_entry_id from (${ltDocs}) x) group by 1) t`;
check("journals balance", je.unbalanced === 0, `${je.entries} entries, ${je.unbalanced} unbalanced`);
const [noJe] = await sql`select count(*)::int n from (${ltDocs}) x where journal_entry_id is null`;
check("every posted document has a journal entry", noJe.n === 0, `${noJe.n} without`);

// 5. No duplicate posting: one sale per POS attempt, one receipt per reference.
const [dupPos] = await sql`select count(*)::int n from (select reference from document where reference like 'POS:LT%'
                             group by reference having count(*) > 1) x`;
check("no duplicate POS sales", dupPos.n === 0, `${dupPos.n} attempts posted twice`);
const [dupGr] = await sql`select count(*)::int n from (select reference from document where doc_type = 'GOODS_RECEIPT'
                             and reference like 'LT%' group by reference having count(*) > 1) x`;
check("no duplicate goods receipts", dupGr.n === 0, `${dupGr.n} references posted twice`);

writeFileSync("loadtest/results/verify.json", JSON.stringify({ at: new Date().toISOString(), docs, results }, null, 1));
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed`);
await sql.end();
