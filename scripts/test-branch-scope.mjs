// Where each person may work: their own branch, or every branch for an
// administrator or a manager without one.
//
//   ./node_modules/.bin/tsx scripts/test-branch-scope.mjs
//
// Tests the rule (lib/branch-rule.ts) that the forms and the posting actions
// both use. It is a test of the rule, not of a request: that the actions call
// it is checked by reading them, and by using the app as a branch cashier.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
if (!process.env.DATABASE_URL && existsSync(join(root, ".env"))) {
  for (const line of readFileSync(join(root, ".env"), "utf8").split("\n")) {
    const m = line.match(/^\s*DATABASE_URL\s*=\s*(.+?)\s*$/);
    if (m) { process.env.DATABASE_URL = m[1].replace(/^["']|["']$/g, ""); break; }
  }
}
const url = process.env.DATABASE_URL;
const sql = postgres(url, { ssl: url.includes("localhost") ? false : "require",
  prepare: !url.includes("-pooler."), onnotice: () => {}, max: 1 });
const { locationsForUser } = await import("../lib/branch-rule.ts");

let bad = 0;
const check = (label, ok, detail = "") => {
  if (!ok) bad++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
};

try {
  const [co] = await sql`select id, name from company order by created_at limit 1`;
  const branches = await sql`
    select b.id, b.code, array_remove(array_agg(w.id), null) as children
      from location b left join location w on w.parent_id = b.id
     where b.company_id = ${co.id} and b.parent_id is null and b.is_active
     group by b.id, b.code order by b.code`;
  console.log(`\n  ${co.name} — ${branches.length} branches\n`);
  if (branches.length < 2) throw new Error("This test needs at least two branches on the database.");
  const [a, b] = branches;
  const person = (role, branchId) => ({ companyId: co.id, role, branchId });

  for (const role of ["ADMIN", "MANAGER"]) {
    check(`${role} with no branch works everywhere`, (await locationsForUser(person(role, null))) === null);
  }

  for (const role of ["CASHIER", "SALESPERSON", "INVENTORY", "ACCOUNTANT", "MANAGER"]) {
    const mine = await locationsForUser(person(role, a.id));
    check(`${role} at ${a.code}: its own branch`, mine?.has(a.id));
    check(`  and every warehouse under it`, a.children.every((id) => mine?.has(id)), `${a.children.length} warehouses`);
    check(`  but not ${b.code}`, !mine?.has(b.id));
    check(`  nor ${b.code}'s warehouses`, b.children.every((id) => !mine?.has(id)), `${b.children.length} warehouses`);
  }

  for (const role of ["CASHIER", "SALESPERSON", "INVENTORY", "ACCOUNTANT"]) {
    const none = await locationsForUser(person(role, null));
    check(`${role} with no branch set, several branches: nowhere until one is set`, none instanceof Set && none.size === 0);
  }
} catch (e) {
  bad++;
  console.error("\n  CRASH", e);
} finally {
  await sql.end();
}
console.log(bad ? `\n  ${bad} FAILED\n` : "\n  all passed\n");
process.exit(bad ? 1 : 0);
