// Splitting units off a group (lib/fa-split.ts), then the ordinary disposal and transfer on the part.
// Everything runs in one transaction that is rolled back: safe on DEV with real assets present.
//   npx tsx --env-file=.env scripts/test-fa-split.mjs

import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1, onnotice: () => {} });
const [co] = await sql`select id, name from company order by created_at limit 1`;
if (!/DEV/.test(co.name)) { console.error(`"${co.name}" is not DEV`); process.exit(1); }
const { splitUnits } = await import("../lib/fa-split.ts");
const { syncUnits } = await import("../lib/fa-units-db.ts");
const { disposalPreview, disposeAsset, transferAsset } = await import("../lib/fa-move.ts");
const { postJournalVoucher } = await import("../lib/posting.ts");
const { schedule, toUnits, fromUnits, sum } = await import("../lib/fa-engine.ts");

let bad = 0;
const check = (label, ok, detail = "") => { if (!ok) bad++; console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? "  " + detail : ""}`); };
class Rollback extends Error {}
const K = (n) => Number(n);

try {
  await sql.begin(async (tx) => {
    const [br] = await tx`select id from location where company_id = ${co.id} and parent_id is null order by code limit 1`;
    const [user] = await tx`select id from app_user where company_id = ${co.id} order by created_at limit 1`;
    const [cat] = await tx`select id, asset_account_id, accum_account_id, expense_account_id from fa_category where company_id = ${co.id} and name = 'Table, Chair & Locker'`;
    const [a] = await tx`insert into fixed_asset (company_id, code, name, category_id, branch_id, acquisition_date, in_service_date, acquisition_cost,
                           residual_value, useful_life_months, status, quantity, depreciation_start, start_convention)
                         values (${co.id}, 'ZZS-1', 'Split probe tables', ${cat.id}, ${br.id}, '2025-12-28', '2025-12-28', 512975, 0, 36, 'ACTIVE', 3, '2026-01-01', 'SAME_MONTH')
                         returning id`;
    await syncUnits(tx, co.id, [a.id]);
    const units = await tx`select id, code, cost::text from fa_unit where asset_id = ${a.id} order by seq`;
    check("three units made, adding up to the cost", units.length === 3 && units.reduce((t, u) => t + K(u.cost), 0) === 512975, units.map((u) => u.cost).join(" "));

    // Two months posted, as depreciation runs would: one voucher each, linked as the module's own.
    for (const m of ["2026-01", "2026-02"]) {
      const v = await postJournalVoucher({ companyId: co.id, docDate: `${m}-28`, locationId: br.id, memo: `probe ${m}`,
        lines: [{ accountId: cat.expense_account_id, amount: 14249 }, { accountId: cat.accum_account_id, amount: -14249 }] }, tx);
      const [jl] = await tx`select jl.id from journal_line jl join document d on d.journal_entry_id = jl.journal_entry_id
                             where d.id = ${v.id} and jl.account_id = ${cat.accum_account_id}`;
      await tx`insert into fa_depreciation (company_id, asset_id, period_month, source, amount, journal_line_id, created_by)
               values (${co.id}, ${a.id}, ${m + "-01"}, 'HISTORICAL', 14249, ${jl.id}, ${user.id})`;
    }
    const lineTotal = async () => K((await tx`select coalesce(sum(amount), 0)::text as v from fa_depreciation where journal_line_id in
      (select journal_line_id from fa_depreciation where asset_id = ${a.id})`)[0].v);
    const before = await lineTotal();

    // Split the second table off.
    const child = await splitUnits(tx, co.id, user.id, a.id, [units[1].id]);
    const [p, c] = [(await tx`select code, acquisition_cost::text cost, quantity::int q from fixed_asset where id = ${a.id}`)[0],
                    (await tx`select code, acquisition_cost::text cost, quantity::int q, parent_asset_id from fixed_asset where id = ${child}`)[0]];
    check("the split part is the unit, under its own code", c.code === "ZZS-1-02" && c.q === 1 && K(c.cost) === 170991.67 && c.parent_asset_id === a.id, JSON.stringify(c));
    check("the group keeps two units and the rest of the cost", p.q === 2 && K(p.cost) + K(c.cost) === 512975, `${p.cost} + ${c.cost}`);
    check("the unit moved with its code", (await tx`select asset_id from fa_unit where id = ${units[1].id}`)[0].asset_id === child);
    const deps = await tx`select asset_id, to_char(period_month,'YYYY-MM') m, amount::text from fa_depreciation where asset_id in (${a.id}, ${child}) order by m, asset_id`;
    const byMonth = (m) => deps.filter((d) => d.m === m).reduce((t, d) => t + K(d.amount), 0);
    check("each posted month still adds up to what was posted", byMonth("2026-01") === 14249 && byMonth("2026-02") === 14249, JSON.stringify(deps.map((d) => d.amount)));
    check("the journal lines are carried in full, between the two", (await lineTotal()) === before, `${before} → ${await lineTotal()}`);

    // The engine on each, from March: the two schedules add up to the group's.
    const sched = async (id) => {
      const [x] = await tx`select acquisition_cost::text cost, useful_life_months life from fixed_asset where id = ${id}`;
      const posted = new Map((await tx`select to_char(period_month,'YYYY-MM') m, sum(amount)::text v from fa_depreciation where asset_id = ${id} group by 1`).map((r) => [r.m, toUnits(r.v)]));
      return schedule({ cost: toUnits(x.cost), residual: 0n, lifeMonths: x.life, inService: "2025-12-28", convention: "SAME_MONTH", startMonth: "2026-01" }, { posted });
    };
    const [sp, sc] = [await sched(a.id), await sched(child)];
    check("both schedules end on zero", sp.at(-1).closing === 0n && sc.at(-1).closing === 0n);
    check("together they spend the whole cost", sum(sp.map((r) => r.amount)) + sum(sc.map((r) => r.amount)) === toUnits("512975"));
    const mar = (s) => Number(fromUnits(s.find((r) => r.month === "2026-03").amount));
    check("March: the parts come to the group's month, to rounding", Math.abs(mar(sp) + mar(sc) - 14249) <= 1, `${mar(sp)} + ${mar(sc)}`);

    // The ordinary disposal on the split part: its own cost and accumulated, nothing of the group's.
    const pv = await disposalPreview(co.id, { assetId: child, date: "2026-03-15", proceeds: "100000", proceedsAccountId: null }, tx);
    check("disposal preview: the unit's cost", K(pv.cost) === 170991.67, pv.cost);
    check("disposal preview: the unit's share of what is posted", K(pv.accumulated) === byMonth("2026-01") / 3 * 0 + deps.filter((d) => d.asset_id === child).reduce((t, d) => t + K(d.amount), 0), pv.accumulated);
    check("the preview stops on the posted months", pv.blockers.length > 0 && /not all posted/.test(pv.blockers[0]), pv.blockers.join(" "));

    // A transfer of the split part posts one voucher for its own figures.
    const [other] = await tx`insert into location (company_id, code, name, is_stock_location) values (${co.id}, 'ZZS-B', 'Split probe branch', false) returning id`;
    const t = await transferAsset(co.id, user.id, { assetId: child, toBranchId: other.id, date: "2026-03-01", note: "probe" }, tx);
    const lines = await tx`select sum(jl.base_amount) filter (where jl.base_amount > 0)::text as dr from journal_line jl join document d on d.journal_entry_id = jl.journal_entry_id where d.doc_no = ${t.docNo}`;
    const accum = deps.filter((d) => d.asset_id === child).reduce((t2, d) => t2 + K(d.amount), 0);
    check("the transfer voucher moves the unit's cost and accumulated only", Math.abs(K(lines[0].dr) - (170991.67 + accum)) < 0.01, `${lines[0].dr} vs ${170991.67 + accum}`);
    check("the group stays where it was", (await tx`select branch_id from fixed_asset where id = ${a.id}`)[0].branch_id === br.id);

    // Every unit chosen splits nothing.
    const same = await splitUnits(tx, co.id, user.id, a.id, (await tx`select id from fa_unit where asset_id = ${a.id}`).map((u) => u.id));
    check("choosing every unit keeps the asset itself", same === a.id);
    throw new Rollback();
  });
} catch (e) {
  if (!(e instanceof Rollback)) { bad++; console.error(e); }
}
await sql.end();
console.log(bad ? `\n${bad} FAILED (rolled back)` : "\nfa-split: all good (rolled back)");
process.exit(bad ? 1 : 0);
