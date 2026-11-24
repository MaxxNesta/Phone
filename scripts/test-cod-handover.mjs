// Cash on delivery is a sale only when the parcel is handed over and paid (0233).
//
// The owner's acceptance example: a phone at 1,000,000 MMK with a 5,000
// delivery charge, costing 800,000. Each step checks the journals, the
// customer's receivable and aging, where the IMEI is, and stock value.
//
//   A  own driver, dispatch now: part payment refused, deposit, handover,
//      duplicate refused, hand-in counted short
//   B  courier, dispatch later: not home, retry, handover, pay-in less fee
//   C  refused at the door: return in transit, wrong IMEI refused, scanned back
//   D  wallet paid direct, split delivery: pending transfer refused, the
//      charge billed once
//
// One transaction, always rolled back: safe on a database with real data.
//
//   npx tsx scripts/test-cod-handover.mjs

const { sql } = await import("../lib/db.ts");
const P = await import("../lib/posting.ts");
const C = await import("../lib/cod.ts");
const K = await import("../lib/cod-couriers.ts");

let failed = 0;
const check = (what, ok, got) => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${what}${ok ? "" : `   (got ${JSON.stringify(got)})`}`); if (!ok) failed++; };
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;
class Rollback extends Error {}

try {
  await sql.begin(async (tx) => {
    const one = async (q) => (await q)[0];
    const co = await one(tx`select id from company order by created_at limit 1`);
    const wh = await one(tx`select id from location where company_id = ${co.id} and is_stock_location and not is_quarantine and not is_transit
                             and is_active and parent_id is not null order by code limit 1`);
    const day = new Date().toISOString().slice(0, 10);
    const tag = Date.now() % 100000;
    const [grp] = await tx`select id from item_group where company_id = ${co.id} limit 1`;
    const [uom] = await tx`select id from uom where company_id = ${co.id} limit 1`;
    const phone = await one(tx`insert into item (company_id, item_group_id, code, serial, name, base_uom_id, is_stocked, tracks_serial)
                               values (${co.id}, ${grp.id}, ${"CODP" + tag}, ${"CODP" + tag}, 'COD test phone', ${uom.id}, true, true) returning id`);
    const supplier = await one(tx`insert into business_partner (company_id, code, name, is_supplier) values (${co.id}, ${"CS" + tag}, 'COD supplier', true) returning id`);
    const cust = await one(tx`insert into business_partner (company_id, code, name, is_customer) values (${co.id}, ${"CC" + tag}, 'COD customer', true) returning id`);
    const courier = await one(tx`insert into business_partner (company_id, code, name, is_courier) values (${co.id}, ${"CK" + tag}, 'Test Express', true) returning id`);
    const driver = await one(tx`insert into driver (company_id, code, name) values (${co.id}, ${"DR" + tag}, 'Ko Driver') returning id`);
    const imei = Array.from({ length: 10 }, (_, i) => `CODT${tag}${i}`);
    await P.postGoodsReceipt({ companyId: co.id, partnerId: supplier.id, locationId: wh.id, docDate: day,
      lines: [{ itemId: phone.id, qty: 10, unitCost: 800000, serials: imei }] }, tx);

    const role = async (r) => (await one(tx`select account_id from system_account where company_id = ${co.id} and role = ${r}`))?.account_id;
    const CWD = await role("CASH_WITH_DRIVERS"), CODR = await role("COD_RECEIVABLE"), CARR = await role("CARRIAGE_OUTWARD"), DI = await role("DELIVERY_INCOME");
    const AR = (await one(tx`select fn_resolve_control_account(${co.id}, 'AR_CONTROL', ${cust.id}) as a`)).a;
    const SALES = (await one(tx`select fn_resolve_account_for_item(${co.id}, 'REVENUE', ${phone.id}) as a`)).a;
    const COGS = (await one(tx`select fn_resolve_account_for_item(${co.id}, 'COGS', ${phone.id}) as a`)).a;
    const till = await one(tx`select id from account where company_id = ${co.id} and is_cash_account and not is_bank_account and is_postable and code = '1110'`)
      ?? await one(tx`select id from account where company_id = ${co.id} and is_cash_account and not is_bank_account and is_postable order by code limit 1`);
    const bank = await one(tx`select id from account where company_id = ${co.id} and is_bank_account and is_postable order by code limit 1`);
    check("roles: Cash with Drivers, COD Receivable, Carriage Outward, Delivery Income", Boolean(CWD && CODR && CARR && DI), { CWD, CODR, CARR, DI });

    const bal = async (acct, partnerId) => (await one(tx`select coalesce(sum(base_amount), 0)::float as v from journal_line
                                                          where account_id = ${acct} ${partnerId ? tx`and partner_id = ${partnerId}` : tx``}`)).v;
    const onDocs = async (acct, ids) => (await one(tx`select coalesce(sum(jl.base_amount), 0)::float as v from journal_line jl
                                                       join journal_entry e on e.id = jl.journal_entry_id where e.source_id = any(${ids}) and jl.account_id = ${acct}`)).v;
    const owed = async (id) => (await one(tx`select coalesce((select outstanding::float from v_open_item where document_id = ${id}), 0) as v`)).v;
    const aged = async (id) => Boolean(await one(tx`select 1 from v_open_item where document_id = ${id}`));
    const unit = async (sn) => one(tx`select v.status, l.code, l.is_transit from v_stock_serial v join location l on l.id = v.location_id where v.imei = ${sn}`)
      ?? one(tx`select v.status from v_stock_serial v where v.imei = ${sn}`);
    const stockValue = async () => (await one(tx`select coalesce(sum(total_cost), 0)::float as v from stock_movement where item_id = ${phone.id}`)).v;
    const driverHolds = async () => (await one(tx`select coalesce(sum(jl.base_amount), 0)::float as v from journal_line jl join journal_entry je on je.id = jl.journal_entry_id
                                                   join document d on d.id = je.source_id where jl.account_id = ${CWD} and d.driver_id = ${driver.id}`)).v;
    const attempt = (fn) => tx.savepoint(fn).then(() => "posted", (e) => e.message);
    const codInvoice = (qty, fee, extra) => P.postSalesInvoice({ companyId: co.id, partnerId: cust.id, locationId: wh.id, docDate: day, dueDate: day,
      paymentType: "COD", codOnHandover: true, toDeliver: true, deliveryFee: fee, lines: [{ itemId: phone.id, qty, unitPrice: 1000000 }], ...extra }, tx);
    const lineOf = async (inv) => (await one(tx`select id from document_line where document_id = ${inv.id}`)).id;

    console.log("\n  A  own driver, dispatch now");
    const a = await codInvoice(1, 5000, { driverId: driver.id });
    const aDoc = await one(tx`select journal_entry_id, ar_on_handover, gross_total::float as g from document where id = ${a.id}`);
    check("the COD invoice posts nothing: no entry", aDoc.journal_entry_id === null && aDoc.ar_on_handover, aDoc);
    check("and is in no receivable or aging bucket", !(await aged(a.id)), await owed(a.id));
    const v0 = await stockValue();
    const pa = await C.codDispatch(tx, { companyId: co.id, invoiceId: a.id, docDate: day, driverId: driver.id,
      lines: [{ lineId: await lineOf(a), qty: 1, serials: [imei[0]] }] });
    const u0 = await unit(imei[0]);
    check("dispatch: the IMEI is in the Out for delivery bin, not for sale", u0.status === "IN_STOCK" && u0.is_transit, u0);
    check("stock value is unchanged: still company stock at 800,000", near(await stockValue(), v0), [v0, await stockValue()]);
    check("still nothing owed before acceptance", !(await aged(a.id)), await owed(a.id));
    const sell = await attempt((s) => P.postSaleWithDelivery({ companyId: co.id, partnerId: cust.id, locationId: wh.id, docDate: day, dueDate: day,
      memo: null, reference: null, cashIn: 0, cashAccountId: null, paymentType: "CREDIT", allowOverCreditLimit: true, creditOverrideReason: "t",
      lines: [{ itemId: phone.id, qty: 1, unitPrice: 1, serials: [imei[0]] }] }, s));
    check("the dispatched IMEI cannot be sold again", sell !== "posted", sell);
    const p = await C.parcel(pa.id, tx);
    check("the parcel says what to collect: 1,005,000", near(p.due, 1005000), p.due);

    const part = await attempt((s) => C.confirmHandover(s, { companyId: co.id, parcelId: pa.id, docDate: day, payment: { to: "DRIVER", amount: 500000 } }));
    check("part payment does not release the phone", part !== "posted" && (await unit(imei[0])).is_transit, part);
    await C.recordDeposit(tx, { companyId: co.id, parcelId: pa.id, docDate: day, payment: { to: "DRIVER", amount: 300000 } });
    check("the 300,000 taken is a deposit the driver holds, not a sale", near(await driverHolds(), 300000) && !(await aged(a.id)), await driverHolds());
    const h = await C.confirmHandover(tx, { companyId: co.id, parcelId: pa.id, docDate: day, payment: { to: "DRIVER", amount: 705000 } });
    check("handover bills 1,005,000, the deposit applied once, 705,000 collected", near(h.billed, 1005000) && near(h.deposits, 300000) && near(h.due, 705000), h);
    check("customer AR is zero", near(await owed(a.id), 0) && !(await aged(a.id)), await owed(a.id));
    check("driver holds 1,005,000", near(await driverHolds(), 1005000), await driverHolds());
    check("Sales 1,000,000 and Delivery Income 5,000 at handover", near(await onDocs(SALES, [h.delivery.id]), -1000000) && near(await onDocs(DI, [h.delivery.id]), -5000),
      [await onDocs(SALES, [h.delivery.id]), await onDocs(DI, [h.delivery.id])]);
    const glAt = await one(tx`select count(*) filter (where jl.location_id = ${wh.id})::int as at_wh, count(*)::int as n
                                from journal_line jl join journal_entry je on je.id = jl.journal_entry_id where je.source_id = ${h.delivery.id}`);
    check("handover lines count in the warehouse, not the bin (branch reports)", glAt.at_wh === glAt.n, glAt);
    check("cost of sales 800,000 at handover", near(await onDocs(COGS, [h.delivery.id]), 800000), await onDocs(COGS, [h.delivery.id]));
    check("the IMEI is sold, stock down 800,000", (await unit(imei[0])).status === "SOLD" && near(await stockValue(), v0 - 800000), [await unit(imei[0]), await stockValue()]);
    const tillBefore = await bal(till.id);
    check("the shop till has not moved yet", near(await bal(till.id), tillBefore), 0);
    const dup = await attempt((s) => C.confirmHandover(s, { companyId: co.id, parcelId: pa.id, docDate: day, payment: { to: "DRIVER", amount: 705000 } }));
    check("confirming twice is refused", dup !== "posted" && /already handed over/.test(dup), dup);
    const cash = await C.driversCash(co.id, tx);
    const mine = cash.find((c) => c.driverId === driver.id);
    check("Receive from driver lists both collections", mine?.collections.length === 2, mine);
    await C.receiveFromDriver({ companyId: co.id, driverId: driver.id, docDate: day, locationId: wh.id, tillAccountId: till.id,
      counted: 1000000, receiptIds: mine.collections.map((c) => c.id) }, tx);
    check("hand-in: the till takes the 1,000,000 counted", near(await bal(till.id) - tillBefore, 1000000), await bal(till.id) - tillBefore);
    check("and the 5,000 short stays against the driver", near(await driverHolds(), 5000), await driverHolds());

    console.log("\n  B  courier, dispatch later, not home then retry");
    const b = await codInvoice(1, 5000, { courierId: courier.id });
    check("dispatch later: the IMEI stays in the warehouse", (await unit(imei[1])).status === "IN_STOCK" && !(await unit(imei[1])).is_transit, await unit(imei[1]));
    const pb = await C.codDispatch(tx, { companyId: co.id, invoiceId: b.id, docDate: day, courierId: courier.id,
      lines: [{ lineId: await lineOf(b), qty: 1, serials: [imei[1]] }] });
    await C.notHome(tx, { companyId: co.id, parcelId: pb.id, reason: "Nobody home", retryOn: day });
    const pbs = await C.parcel(pb.id, tx);
    check("not home: the courier still has it, retry date kept", pbs.state === "NOT_HOME" && pbs.retryOn === day && (await unit(imei[1])).is_transit, pbs);
    check("no second invoice or stock issue on retry", (await one(tx`select count(*)::int as n from document where source_document_id = ${b.id}`)).n === 1, 0);
    await K.courierCollected(tx, { companyId: co.id, courierId: courier.id, docDate: day, parcelIds: [pb.id] });
    check("courier collected: 1,005,000 in COD Receivable under it", near(await bal(CODR, courier.id), 1005000), await bal(CODR, courier.id));
    check("the customer owes nothing", near(await owed(b.id), 0), await owed(b.id));
    const bankBefore = await bal(bank.id);
    await K.remitCourier({ companyId: co.id, courierId: courier.id, docDate: day, locationId: wh.id, moneyAccountId: bank.id,
      received: 1002000, fee: 3000, collectParcelIds: [] }, tx);
    const carrOnPayIn = (await one(tx`select coalesce(sum(jl.base_amount), 0)::float as v from journal_line jl join journal_entry je on je.id = jl.journal_entry_id
                                       join document d on d.id = je.source_id where jl.account_id = ${CARR} and d.partner_id = ${courier.id}`)).v;
    check("Carriage Outward takes the courier's 3,000 once", near(carrOnPayIn, 3000), carrOnPayIn);
    check("pay-in: bank 1,002,000, Carriage Outward 3,000, courier cleared",
      near(await bal(bank.id) - bankBefore, 1002000) && near(await bal(CODR, courier.id), 0), [await bal(bank.id) - bankBefore, await bal(CODR, courier.id)]);

    console.log("\n  C  refused at the door");
    const c = await codInvoice(1, 5000, { driverId: driver.id });
    const pc = await C.codDispatch(tx, { companyId: co.id, invoiceId: c.id, docDate: day, driverId: driver.id,
      lines: [{ lineId: await lineOf(c), qty: 1, serials: [imei[2]] }] });
    const early = await attempt((s) => C.receiveReturn(s, { companyId: co.id, parcelId: pc.id, docDate: day, scanned: [imei[2]] }));
    check("a parcel not refused cannot be received back", early !== "posted", early);
    await C.refused(tx, { companyId: co.id, parcelId: pc.id, reason: "Changed mind" });
    check("refused: return in transit, the phone still out", (await C.parcel(pc.id, tx)).state === "REFUSED" && (await unit(imei[2])).is_transit, 0);
    const wrong = await attempt((s) => C.receiveReturn(s, { companyId: co.id, parcelId: pc.id, docDate: day, scanned: [imei[3]] }));
    check("scanning a different IMEI is refused", wrong !== "posted", wrong);
    await C.receiveReturn(tx, { companyId: co.id, parcelId: pc.id, docDate: day, scanned: [imei[2]] });
    const u2 = await unit(imei[2]);
    check("scanned back: sellable in the warehouse at its cost", u2.status === "IN_STOCK" && !u2.is_transit, u2);
    check("nothing was ever owed or earned on it", !(await aged(c.id)) && (await one(tx`select journal_entry_id from document where id = ${c.id}`)).journal_entry_id === null, 0);

    console.log("\n  D  wallet paid direct, split delivery");
    const d = await codInvoice(2, 5000, { driverId: driver.id });
    const dl = await lineOf(d);
    const pd1 = await C.codDispatch(tx, { companyId: co.id, invoiceId: d.id, docDate: day, driverId: driver.id, lines: [{ lineId: dl, qty: 1, serials: [imei[3]] }] });
    check("partial dispatch leaves one to go", (await C.undispatched(d.id, tx))[0].qty === 1, await C.undispatched(d.id, tx));
    const pending = await attempt((s) => C.confirmHandover(s, { companyId: co.id, parcelId: pd1.id, docDate: day,
      payment: { to: "ACCOUNT", accountId: bank.id, verified: false, amount: 1005000 } }));
    check("a pending transfer does not release the phone", pending !== "posted", pending);
    const bank2 = await bal(bank.id), cwd2 = await driverHolds();
    const h1 = await C.confirmHandover(tx, { companyId: co.id, parcelId: pd1.id, docDate: day,
      payment: { to: "ACCOUNT", accountId: bank.id, verified: true, amount: 1005000, reference: "KBZPay 1234" } });
    check("paid into the wallet: bank debited direct, no driver cash", near(await bal(bank.id) - bank2, 1005000) && near(await driverHolds(), cwd2), h1);
    const pd2 = await C.codDispatch(tx, { companyId: co.id, invoiceId: d.id, docDate: day, driverId: driver.id, lines: [{ lineId: dl, qty: 1, serials: [imei[4]] }] });
    check("second parcel: the charge is not due again", near((await C.parcel(pd2.id, tx)).due, 1000000), (await C.parcel(pd2.id, tx)).due);
    const h2 = await C.confirmHandover(tx, { companyId: co.id, parcelId: pd2.id, docDate: day, payment: { to: "DRIVER", amount: 1000000 } });
    check("second handover bills 1,000,000 only", near(h2.billed, 1000000), h2.billed);
    check("Delivery Income 5,000 once across both", near(await onDocs(DI, [h1.delivery.id, h2.delivery.id]), -5000), await onDocs(DI, [h1.delivery.id, h2.delivery.id]));
    check("invoice settled in full", near(await owed(d.id), 0), await owed(d.id));

    console.log("\n  E  not home, brought back to the shop: exactly what went out");
    const e = await codInvoice(1, 5000, { driverId: driver.id });
    const el = await lineOf(e);
    const pe = await C.codDispatch(tx, { companyId: co.id, invoiceId: e.id, docDate: day, driverId: driver.id, lines: [{ lineId: el, qty: 1, serials: [imei[5]] }] });
    await C.notHome(tx, { companyId: co.id, parcelId: pe.id, reason: "Nobody home" });
    const eWrong = await attempt((s) => C.receiveReturn(s, { companyId: co.id, parcelId: pe.id, docDate: day, scanned: [imei[0]] }));
    check("not home: another IMEI is refused at the shop door", eWrong !== "posted", eWrong);
    await C.receiveReturn(tx, { companyId: co.id, parcelId: pe.id, docDate: day, scanned: [imei[5]] });
    const u5 = await unit(imei[5]);
    check("the same IMEI is back in the warehouse, for sale", u5.status === "IN_STOCK" && !u5.is_transit, u5);
    check("nothing owed, and the invoice can go out again", !(await aged(e.id)) && (await C.undispatched(e.id, tx))[0].qty === 1, 0);
    const acc = await one(tx`insert into item (company_id, item_group_id, code, serial, name, base_uom_id, is_stocked)
                             values (${co.id}, ${grp.id}, ${"CODA" + tag}, ${"CODA" + tag}, 'COD test case', ${uom.id}, true) returning id`);
    await P.postGoodsReceipt({ companyId: co.id, partnerId: supplier.id, locationId: wh.id, docDate: day, lines: [{ itemId: acc.id, qty: 5, unitCost: 2000 }] }, tx);
    const f = await P.postSalesInvoice({ companyId: co.id, partnerId: cust.id, locationId: wh.id, docDate: day, dueDate: day,
      paymentType: "COD", codOnHandover: true, toDeliver: true, lines: [{ itemId: acc.id, qty: 2, unitPrice: 5000 }] }, tx);
    const fl = await lineOf(f);
    const pf = await C.codDispatch(tx, { companyId: co.id, invoiceId: f.id, docDate: day, driverId: driver.id, lines: [{ lineId: fl, qty: 2 }] });
    await C.notHome(tx, { companyId: co.id, parcelId: pf.id, reason: "Shop shut" });
    const short = await attempt((s) => C.receiveReturn(s, { companyId: co.id, parcelId: pf.id, docDate: day, scanned: [], counted: { [fl]: 1 } }));
    check("an accessory counted back short is refused", short !== "posted", short);
    const onHand = async () => (await one(tx`select coalesce(sum(qty), 0)::float as q from stock_movement where item_id = ${acc.id} and location_id = ${wh.id}`)).q;
    await C.receiveReturn(tx, { companyId: co.id, parcelId: pf.id, docDate: day, scanned: [], counted: { [fl]: 2 } });
    check("counted back in full: all 5 in the warehouse again", near(await onHand(), 5), await onHand());

    console.log("\n  F  a courier that bills its fee separately");
    const g = await codInvoice(1, 5000, { courierId: courier.id });
    const pg = await C.codDispatch(tx, { companyId: co.id, invoiceId: g.id, docDate: day, courierId: courier.id,
      lines: [{ lineId: await lineOf(g), qty: 1, serials: [imei[2]] }] });
    await K.courierCollected(tx, { companyId: co.id, courierId: courier.id, docDate: day, parcelIds: [pg.id] });
    const billedFee = await attempt((s) => K.remitCourier({ companyId: co.id, courierId: courier.id, docDate: day, locationId: wh.id, moneyAccountId: bank.id,
      received: 1002000, fee: 3000, feeMode: "BILLED", collectParcelIds: [] }, s));
    check("billed separately: a fee on the pay-in is refused, so it is expensed once", billedFee !== "posted", billedFee);
    const bank3 = await bal(bank.id), carr3 = await bal(CARR);
    await K.remitCourier({ companyId: co.id, courierId: courier.id, docDate: day, locationId: wh.id, moneyAccountId: bank.id,
      received: 1005000, fee: 0, feeMode: "BILLED", collectParcelIds: [] }, tx);
    check("the full 1,005,000 is received, no Carriage Outward yet, courier cleared",
      near(await bal(bank.id) - bank3, 1005000) && near(await bal(CARR), carr3) && near(await bal(CODR, courier.id), 0),
      [await bal(bank.id) - bank3, await bal(CARR) - carr3, await bal(CODR, courier.id)]);

    console.log("\n  G  split parcels: what the slip tells the carrier");
    const g2 = await codInvoice(2, 5000, { driverId: driver.id });
    const g2l = await lineOf(g2);
    const ga = await C.codDispatch(tx, { companyId: co.id, invoiceId: g2.id, docDate: day, driverId: driver.id, lines: [{ lineId: g2l, qty: 1, serials: [imei[6]] }] });
    const gb = await C.codDispatch(tx, { companyId: co.id, invoiceId: g2.id, docDate: day, driverId: driver.id, lines: [{ lineId: g2l, qty: 1, serials: [imei[7]] }] });
    await C.recordDeposit(tx, { companyId: co.id, parcelId: ga.id, docDate: day, payment: { to: "DRIVER", amount: 300000 } });
    let pa1 = await C.parcel(ga.id, tx), pb1 = await C.parcel(gb.id, tx);
    check("each split slip names its amount and the other parcel: 705,000 (1,000,000 if the other goes first)",
      C.collectText(pa1) === `Collect 705,000 MMK (1,000,000 MMK if ${pb1.no} goes first)` && C.collectText(pb1) === `Collect 705,000 MMK (1,000,000 MMK if ${pa1.no} goes first)`,
      [C.collectText(pa1), C.collectText(pb1)]);
    check("the invoice and a courier batch count the deposit and charge once: 1,705,000", near(C.collectTotal([pa1, pb1]), 1705000), C.collectTotal([pa1, pb1]));
    const gh2 = await C.confirmHandover(tx, { companyId: co.id, parcelId: gb.id, docDate: day, payment: { to: "DRIVER", amount: pb1.collectNow } });
    pa1 = await C.parcel(ga.id, tx);
    check("handed over in reverse order: the second parcel takes 705,000", near(gh2.due, 705000), gh2.due);
    check("the other parcel now says plainly: Collect 1,000,000 MMK", C.collectText(pa1) === "Collect 1,000,000 MMK", C.collectText(pa1));
    await C.confirmHandover(tx, { companyId: co.id, parcelId: ga.id, docDate: day, payment: { to: "DRIVER", amount: pa1.collectNow } });
    check("both handed over at the slip amounts: the customer owes nothing", near(await owed(g2.id), 0), await owed(g2.id));

    console.log("\n  H  lost in transit");
    const DMG = await role("INVENTORY_DAMAGE");
    const lv = await codInvoice(1, 5000, { driverId: driver.id });
    const lvl = await lineOf(lv);
    const sv = await stockValue();
    const pl = await C.codDispatch(tx, { companyId: co.id, invoiceId: lv.id, docDate: day, driverId: driver.id, lines: [{ lineId: lvl, qty: 1, serials: [imei[8]] }] });
    const dmg0 = await bal(DMG);
    const lost = await C.lostInTransit(tx, { companyId: co.id, parcelId: pl.id, docDate: day, reason: "Stolen", bearer: "SHOP" });
    check("lost, borne by the shop: 800,000 to Inventory Damage, stock down by the same", near(await bal(DMG) - dmg0, 800000) && near(await stockValue(), sv - 800000), [await bal(DMG) - dmg0, sv - await stockValue()]);
    check("the IMEI is written off, not sellable", (await unit(imei[8])).status !== "IN_STOCK", await unit(imei[8]));
    check("the customer owes nothing and the invoice can be dispatched again", !(await aged(lv.id)) && (await C.undispatched(lv.id, tx))[0].qty === 1, 0);
    const again2 = await attempt((s) => C.lostInTransit(s, { companyId: co.id, parcelId: pl.id, docDate: day, reason: "x", bearer: "SHOP" }));
    check("a lost parcel cannot be closed twice", again2 !== "posted", again2);
    const pl2 = await C.codDispatch(tx, { companyId: co.id, invoiceId: lv.id, docDate: day, driverId: driver.id, lines: [{ lineId: lvl, qty: 1, serials: [imei[9]] }] });
    check("a replacement goes out on the same invoice", (await C.parcel(pl2.id, tx)).state === "OUT", 0);
    const held0 = await driverHolds();
    await C.lostInTransit(tx, { companyId: co.id, parcelId: pl2.id, docDate: day, reason: "Driver lost it", bearer: "CARRIER" });
    check("lost, borne by the driver: the driver owes the 800,000 cost", near(await driverHolds() - held0, 800000), await driverHolds() - held0);

    const tb = await one(tx`select coalesce(sum(balance), 0)::float as v from v_trial_balance where company_id = ${co.id}`);
    check("the trial balance nets to zero", near(tb.v, 0), tb);
    throw new Rollback();
  });
} catch (e) {
  if (!(e instanceof Rollback)) { console.error("  error:", e.stack ?? e.message); failed++; }
} finally {
  await sql.end();
}
console.log(failed ? `\n  ${failed} failed\n` : "\n  all passed, rolled back, nothing kept\n");
process.exitCode = failed ? 1 : 0;
