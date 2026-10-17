"use server";

import { sql } from "./db";
import { requirePermission } from "./auth";

/** The name of the item already using this code, or null if it is free. Asked as the code is typed. */
export async function itemCodeTakenBy(code: string): Promise<string | null> {
  const user = await requirePermission("items.manage");
  const c = code.trim();
  if (!c) return null;
  const [row] = await sql`
    select name from item where company_id = ${user.companyId} and upper(code) = upper(${c}) limit 1`;
  return row ? (row.name as string) : null;
}

/** The name of the category already using this composed code, or null if it is free. */
export async function categoryCodeTakenBy(code: string): Promise<string | null> {
  const user = await requirePermission("items.manage");
  const c = code.trim();
  if (!c) return null;
  const [row] = await sql`
    select name from item_group where company_id = ${user.companyId} and upper(code) = upper(${c}) limit 1`;
  return row ? (row.name as string) : null;
}
