// Creates Royal, ACT and RD as shareholders, each linked to its capital account. Re-runnable.
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const [co] = await sql`select id, name from company`;
console.log("Company:", co.name);
const hasCol = (await sql`select 1 from information_schema.columns where table_name = 'shareholder' and column_name = 'equity_account_id'`).length > 0;
let k = (await sql`select count(*)::int as n from shareholder where company_id = ${co.id}`)[0].n;
for (const [name, code] of [["Royal", "3130"], ["ACT", "3140"], ["RD", "3150"]]) {
  const [a] = await sql`select id from account where company_id = ${co.id} and code = ${code}`;
  let [h] = await sql`select id, code from shareholder where company_id = ${co.id} and name = ${name}`;
  if (!h) {
    k++;
    [h] = await sql`insert into shareholder (company_id, code, name, is_company) values (${co.id}, ${"SH-" + String(k).padStart(4, "0")}, ${name}, true) returning id, code`;
    console.log("added", h.code, name);
  }
  if (hasCol) await sql`update shareholder set equity_account_id = ${a.id} where id = ${h.id}`;
}
console.table(hasCol
  ? await sql`select s.code, s.name, a.code acct, coalesce((select -sum(base_amount) from journal_line where account_id = s.equity_account_id),0)::float capital from shareholder s left join account a on a.id = s.equity_account_id where s.company_id = ${co.id} order by s.code`
  : await sql`select code, name from shareholder where company_id = ${co.id} order by code`);
await sql.end();
