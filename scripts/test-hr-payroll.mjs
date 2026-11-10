// HR & Payroll (migration 0186): the arithmetic, then a whole month on DEV
// inside one transaction that is rolled back, so DEV keeps no employee,
// advance, payroll or voucher from it.
//   npx tsx --env-file=.env scripts/test-hr-payroll.mjs
import assert from "node:assert/strict";
import postgres from "postgres";

const { slipTotals, suggestRecovery, runJournal } = await import("../lib/hr-calc.ts");
const { ROLE_PERMISSIONS, permissionForPath } = await import("../lib/auth-core.ts");
let n = 0;
const ok = (c, why) => { assert.ok(c, why); n++; };
const U = (v) => BigInt(Math.round(v * 10000));

// ---- calculations ---------------------------------------------------------
{
  const t = slipTotals([{ kind: "BASIC", amount: U(500000) }, { kind: "ALLOWANCE", amount: U(50000) }, { kind: "OVERTIME", amount: U(20000) },
    { kind: "TAX", amount: U(10000) }, { kind: "ADVANCE", amount: U(100000) }]);
  ok(t.gross === U(570000) && t.deductions === U(110000) && t.net === U(460000), "gross, deductions, net");
  assert.throws(() => slipTotals([{ kind: "BASIC", amount: 0n }])); n++;

  const adv = (id, out, method, fixed = null, first = "2026-11-01") => ({ id, outstanding: U(out), method, fixed: fixed && U(fixed), firstPeriod: first });
  const s = suggestRecovery([adv("a", 300000, "FULL"), adv("b", 30000, "FIXED", 50000), adv("c", 90000, "MANUAL"), adv("d", 10, "FULL", null, "2026-12-01")],
    "2026-11-01", U(250000));
  ok(s.length === 1 && s[0].id === "a" && s[0].amount === U(250000), "full recovery capped at what keeps net at zero");
  const s2 = suggestRecovery([adv("b", 30000, "FIXED", 50000)], "2026-11-01", U(500000));
  ok(s2[0].amount === U(30000), "fixed recovery never more than outstanding");
  ok(suggestRecovery([adv("c", 90000, "MANUAL")], "2026-11-01", U(500000)).length === 0, "manual suggests nothing");
  ok(suggestRecovery([adv("d", 10, "FULL", null, "2026-12-01")], "2026-11-01", U(500000)).length === 0, "not before its first period");

  const acc = { basic_account_id: "E1", allowance_account_id: "E1", overtime_account_id: "E2", advance_account_id: "A", tax_account_id: "T" };
  const j = runJournal([{ kind: "BASIC", amount: U(500) }, { kind: "ALLOWANCE", amount: U(50) }, { kind: "OVERTIME", amount: U(20) },
    { kind: "ADVANCE", amount: U(100) }, { kind: "TAX", amount: U(10) }], acc, "P");
  const by = Object.fromEntries(j.lines.map((l) => [l.accountId, l.amount]));
  ok(by.E1 === U(550) && by.E2 === U(20) && by.A === -U(100) && by.T === -U(10) && by.P === -U(460), "one line per account");
  ok(j.lines.reduce((t, l) => t + l.amount, 0n) === 0n, "journal balances");
  ok(runJournal([{ kind: "BONUS", amount: U(1) }], acc, null).missing.join() === "Bonus,Salary payable", "missing accounts are named, not guessed");
}

// ---- permissions ------------------------------------------------------------
{
  const has = (r, p) => ROLE_PERMISSIONS[r].includes(p);
  const all = ["hr.employees.view", "hr.employees.edit", "hr.salary.view", "hr.salary.edit", "hr.advances", "hr.payroll.prepare",
    "hr.payroll.post", "hr.payroll.pay", "hr.payroll.accounting"];
  ok(all.every((p) => has("ADMIN", p)), "admin has every HR permission");
  ok(has("MANAGER", "hr.employees.view") && has("MANAGER", "hr.advances") && !has("MANAGER", "hr.salary.view") && !has("MANAGER", "hr.payroll.post"), "manager: staff and advances, not pay");
  ok(has("ACCOUNTANT", "hr.payroll.accounting") && has("ACCOUNTANT", "hr.payroll.pay") && !has("ACCOUNTANT", "hr.salary.view") && !has("ACCOUNTANT", "hr.payroll.post"),
    "accountant: payroll totals and paying, no one's salary");
  ok(["CASHIER", "SALESPERSON", "INVENTORY"].every((r) => all.every((p) => !has(r, p))), "other roles: nothing");
  ok(permissionForPath("/hr/payslips/x") === "hr.salary.view" && permissionForPath("/hr/settings") === "settings.manage"
    && permissionForPath("/hr/employees/x/edit") === "hr.employees.view" && permissionForPath("/hr/advances") === "hr.advances", "pages are gated");
}

// ---- a month on DEV, rolled back ------------------------------------------
const { sql } = await import("../lib/db.ts");
const hr = await import("../lib/hr.ts");
const { planVoidIn } = await import("../lib/void.ts");
const { toUnits } = await import("../lib/fa-engine.ts");
const [co] = await sql`select id, name from company order by created_at limit 1`;
if (!/\bDEV\b/.test(co.name)) throw new Error("DEV only");
class Rollback extends Error {}
const today = new Date().toISOString().slice(0, 10), ps = today.slice(0, 8) + "01";
const pe = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7), 0)).toISOString().slice(0, 10);

try {
  await sql.begin(async (tx) => {
    const acct = async (code) => {
      const [a] = await tx`select id, is_control from account where company_id = ${co.id} and code = ${code} and is_postable`;
      assert.ok(a && !a.is_control, `account ${code}`); return a.id;
    };
    const [advA, payA, salA, taxA] = [await acct("17101"), await acct("21108"), await acct("61252"), await acct("21109")];
    const [cash] = await tx`select id from account where company_id = ${co.id} and is_cash_account and is_postable and is_active order by code limit 1`;
    const [branch] = await tx`select id from location where company_id = ${co.id} and parent_id is null and is_active order by code limit 1`;
    await tx`insert into hr_setting (company_id, advance_account_id, payable_account_id, basic_account_id, allowance_account_id,
               overtime_account_id, commission_account_id, bonus_account_id, other_earning_account_id, tax_account_id, statutory_account_id, other_deduction_account_id)
             values (${co.id}, ${advA}, ${payA}, ${salA}, ${salA}, ${salA}, ${salA}, ${salA}, ${salA}, ${taxA}, ${taxA}, ${taxA})
             on conflict (company_id) do update set advance_account_id = excluded.advance_account_id, payable_account_id = excluded.payable_account_id,
               basic_account_id = excluded.basic_account_id, allowance_account_id = excluded.allowance_account_id, overtime_account_id = excluded.overtime_account_id,
               tax_account_id = excluded.tax_account_id`;
    const emp = async (code, basic, allowance) => {
      const [e] = await tx`insert into employee (company_id, code, full_name, branch_id) values (${co.id}, ${code}, ${"Test " + code}, ${branch.id}) returning id`;
      const [s] = await tx`insert into hr_salary (company_id, employee_id, effective_from, basic) values (${co.id}, ${e.id}, ${ps}, ${basic}) returning id`;
      if (allowance) await tx`insert into hr_salary_allowance (salary_id, name, amount) values (${s.id}, 'Transport', ${allowance})`;
      return e.id;
    };
    const A = await emp("ZZT-A", "500000", "50000"), B = await emp("ZZT-B", "300000", null);

    // Advance: Dr advance, Cr cash.
    const adv = await hr.createAdvance(tx, { co: co.id, userId: null, employeeId: A, date: today, amount: "300000", moneyAccountId: cash.id,
      reference: null, note: null, method: "FULL", fixed: null, firstPeriod: today.slice(0, 7) });
    const advLines = await tx`select jl.account_id, jl.base_amount::float as a from document d join journal_line jl on jl.journal_entry_id = d.journal_entry_id where d.id = ${adv.documentId}`;
    ok(advLines.find((l) => l.account_id === advA).a === 300000 && advLines.find((l) => l.account_id === cash.id).a === -300000, "advance: Dr advance, Cr cash");

    // Draft run fills basic, allowance and the suggested recovery.
    const [made] = await hr.createRuns(tx, { co: co.id, userId: null, kind: "REGULAR", periodStart: ps, periodEnd: pe, postingDate: today, branchIds: [branch.id], notes: null });
    const slips = await tx`select id, employee_id from hr_payslip where run_id = ${made.id}`;
    const slipA = slips.find((s) => s.employee_id === A).id, slipB = slips.find((s) => s.employee_id === B).id;
    const linesA = await tx`select kind, amount::float as a from hr_payslip_line where payslip_id = ${slipA} order by seq`;
    ok(linesA.some((l) => l.kind === "BASIC" && l.a === 500000) && linesA.some((l) => l.kind === "ALLOWANCE" && l.a === 50000)
      && linesA.some((l) => l.kind === "ADVANCE" && l.a === 300000), "draft: basic, allowance, suggested recovery");

    const line = (kind, amount, advanceId = null, label = "") => ({ kind, label, amount, advanceId });
    await tx.savepoint((sp) => hr.saveSlip(sp, co.id, slipA, [line("BASIC", "500000"), line("ADVANCE", "300001", adv.id)]))
      .then(() => assert.fail("over-recovery saved"), (e) => ok(/outstanding/.test(e.message), "cannot recover more than outstanding"));
    await tx.savepoint((sp) => hr.saveSlip(sp, co.id, slipA, [line("BASIC", "500000"), line("TAX", "600000")]))
      .then(() => assert.fail("negative net saved"), (e) => ok(/negative/.test(e.message), "net pay cannot be negative"));
    await hr.saveSlip(tx, co.id, slipA, [line("BASIC", "500000"), line("ALLOWANCE", "50000", null, "Transport"), line("OVERTIME", "20000"),
      line("ADVANCE", "300000", adv.id), line("TAX", "10000")]);

    // Post: one line per account.
    const posted = await hr.postRun(tx, co.id, made.id, null);
    const jl = await tx`select jl.account_id, sum(jl.base_amount)::float as a, count(*)::int as c from document d join journal_line jl on jl.journal_entry_id = d.journal_entry_id
                         where d.id = ${posted.documentId} group by jl.account_id`;
    const j = Object.fromEntries(jl.map((l) => [l.account_id, l.a]));
    ok(j[salA] === 870000 && j[advA] === -300000 && j[taxA] === -10000 && j[payA] === -560000, "payroll journal: expense, advance, tax, payable");
    ok(jl.every((l) => l.c === 1), "one journal line per account, never per person");
    await tx.savepoint((sp) => hr.postRun(sp, co.id, made.id, null)).then(() => assert.fail("posted twice"), () => ok(true, "posting twice refused"));
    const [after] = await tx`select outstanding::float as o from v_hr_advance where id = ${adv.id}`;
    ok(after.o === 0, "advance recovered");
    await tx.savepoint((sp) => sp`update hr_payslip_line set amount = 1 where payslip_id = ${slipB}`)
      .then(() => assert.fail("posted payslip changed"), () => ok(true, "posted payslips are frozen"));

    // Duplicates: a second regular run leaves both out; a regular run forced to include A is refused.
    const [again] = await hr.createRuns(tx, { co: co.id, userId: null, kind: "REGULAR", periodStart: ps, periodEnd: pe, postingDate: today, branchIds: [branch.id], notes: null });
    ok(again.staff === 0 || !(await tx`select 1 from hr_payslip where run_id = ${again.id} and employee_id = any(${[A, B]})`).length, "regular run skips those already paid");
    await tx`insert into hr_payslip (company_id, run_id, employee_id, employee_code, employee_name) values (${co.id}, ${again.id}, ${A}, 'ZZT-A', 'Test')`;
    const [dupSlip] = await tx`select id from hr_payslip where run_id = ${again.id} and employee_id = ${A}`;
    await tx`insert into hr_payslip_line (payslip_id, kind, label, amount) values (${dupSlip.id}, 'BASIC', 'Basic', 1)`;
    await tx.savepoint((sp) => hr.postRun(sp, co.id, again.id, null))
      .then(() => assert.fail("paid twice"), (e) => ok(/Already paid/.test(e.message), "employee not twice in a posted regular run"));
    // Double recovery at the database: a repayment beyond what is outstanding fails at commit.
    await tx.savepoint(async (sp) => {
      await sp`insert into hr_advance_repayment (company_id, advance_id, document_id, amount) values (${co.id}, ${adv.id}, ${posted.documentId}, 1)`;
      await sp`set constraints all immediate`;
    }).then(() => assert.fail("over-repaid"), (e) => ok(/beyond what was lent/.test(e.message), "database refuses recovering beyond the advance"));

    // Void blockers.
    ok((await planVoidIn(tx, adv.documentId)).blockers.some((b) => /recovered/.test(b.reason)), "a recovered advance cannot be voided");

    // Payment status: partial, then paid.
    const state = async () => {
      const [r] = await tx`select 'POSTED' as status, d.status as journal_status, sum(s.net) as net, sum(s.paid) as paid
                             from v_hr_payslip s join document d on d.id = s.run_document_id where s.run_id = ${made.id} group by d.status`;
      return hr.runState(r);
    };
    ok((await state()) === "POSTED", "posted, unpaid");
    await hr.payRun(tx, { co: co.id, runId: made.id, slipIds: [slipA], date: today, moneyAccountId: cash.id });
    ok((await state()) === "PARTIAL", "partially paid");
    ok((await planVoidIn(tx, posted.documentId)).blockers.some((b) => /paid/.test(b.reason)), "a paid payroll cannot be voided");
    const rest = await hr.payRun(tx, { co: co.id, runId: made.id, slipIds: null, date: today, moneyAccountId: cash.id });
    ok(toUnits(rest.total) === toUnits("300000") && (await state()) === "PAID", "paid in full; batch paid only what was left");
    await tx.savepoint((sp) => hr.payRun(sp, { co: co.id, runId: made.id, slipIds: null, date: today, moneyAccountId: cash.id }))
      .then(() => assert.fail("paid twice"), (e) => ok(/Nothing is left/.test(e.message), "no double payment"));
    const [pay] = await tx`select sum(jl.base_amount)::float as a from hr_salary_payment x join document d on d.id = x.document_id
                            join journal_line jl on jl.journal_entry_id = d.journal_entry_id
                           where x.payslip_id = ${slipA} and jl.account_id = ${payA}`;
    ok(pay.a === 260000, "payment: Dr Salary Payable, A's net pay");

    throw new Rollback();
  });
} catch (e) {
  if (!(e instanceof Rollback)) { await sql.end(); throw e; }
}
// Every page query runs (outside the transaction, so on whatever DEV holds).
const none = "00000000-0000-0000-0000-000000000000";
await Promise.all([hr.employeeList(co.id, null), hr.employeeList(co.id, [none]), hr.advanceList(co.id, null), hr.runList(co.id, null),
  hr.slipList(co.id, null), hr.salaryHistory(none), hr.advanceHistory(none), hr.runJournalLines(none), hr.runPayments(none),
  hr.hrLinksFor(none), hr.run(co.id, none), hr.slip(co.id, none), hr.employee(co.id, none), hr.hrAccounts(co.id), hr.moneyAccounts(co.id)]);
n++;
const [left] = await sql`select count(*)::int as n from employee where company_id = ${co.id} and code like 'ZZT-%'`;
ok(left.n === 0, "nothing left on DEV");
await sql.end();
console.log(`PASS HR & Payroll: ${n} checks`);
process.exit(0);
