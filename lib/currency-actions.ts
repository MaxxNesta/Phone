"use server";

import { revalidatePath } from "next/cache";
import { sql } from "./db";
import { requirePermission, requireUser, can } from "./auth";

type Result = { error: string } | { ok: string } | null;
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

/**
 * A currency the company deals in. The list is shared (currency codes are
 * ISO, not per company), so only an administrator edits it. A code that any
 * document, journal line, rate or partner uses cannot be deleted — those
 * records would lose what their figures mean.
 */
export async function saveCurrency(_prev: Result, fd: FormData): Promise<Result> {
  await requirePermission("settings.manage");
  const code = str(fd, "code").toUpperCase();
  const name = str(fd, "name");
  const symbol = str(fd, "symbol") || null;
  const decimals = Number(str(fd, "decimal_places") || "2");
  if (!/^[A-Z]{3}$/.test(code)) return { error: "A currency code is three letters, like CNY or USD." };
  if (!name) return { error: "Give the currency a name." };
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 4) return { error: "Decimals must be 0 to 4." };
  await sql`
    insert into currency (code, name, symbol, decimal_places)
    values (${code}, ${name}, ${symbol}, ${decimals})
    on conflict (code) do update
      set name = excluded.name, symbol = excluded.symbol, decimal_places = excluded.decimal_places`;
  revalidatePath("/settings/currencies");
  return { ok: `${code} saved` };
}

export async function deleteCurrency(fd: FormData) {
  await requirePermission("settings.manage");
  const code = str(fd, "code");
  const [used] = await sql`
    select (exists (select 1 from document where currency = ${code})
         or exists (select 1 from journal_line where currency = ${code})
         or exists (select 1 from exchange_rate where from_currency = ${code} or to_currency = ${code})
         or exists (select 1 from business_partner where currency = ${code})
         or exists (select 1 from company where base_currency = ${code})
         or exists (select 1 from account where currency = ${code})
         or exists (select 1 from item_price where currency = ${code})) as yes`;
  if (used?.yes) throw new Error(`${code} is in use and cannot be deleted.`);
  await sql`delete from currency where code = ${code}`;
  revalidatePath("/settings/currencies");
}

/** Who may keep rates: whoever buys stock or keeps the books. */
async function rateKeeper() {
  const user = await requireUser();
  if (!can(user, "purchase.post") && !can(user, "accounting.post") && !can(user, "settings.manage")) {
    throw new Error("Your role cannot record exchange rates. Ask a manager.");
  }
  return user;
}

/**
 * The rate from a date onward: how many units of the company's currency one
 * unit of the foreign currency costs. One rate per currency, type and day;
 * entering the same day again corrects it. Documents copy the rate when they
 * post, so changing or deleting a rate later never restates them.
 */
export async function saveRate(_prev: Result, fd: FormData): Promise<Result> {
  const user = await rateKeeper();
  const from = str(fd, "from_currency").toUpperCase();
  const type = str(fd, "rate_type") || "MARKET";
  const validFrom = str(fd, "valid_from");
  const rate = Number(str(fd, "rate"));
  const [co] = await sql`select base_currency from company where id = ${user.companyId}`;
  if (!from || from === co.base_currency) return { error: "Choose a foreign currency." };
  if (!validFrom) return { error: "Choose the date the rate applies from." };
  if (!(rate > 0)) return { error: "A rate must be more than zero." };
  await sql`
    insert into exchange_rate (company_id, from_currency, to_currency, rate_type, valid_from, rate)
    values (${user.companyId}, ${from}, ${co.base_currency}, ${type}, ${validFrom}::date, ${rate})
    on conflict (company_id, from_currency, to_currency, rate_type, valid_from)
      do update set rate = excluded.rate`;
  revalidatePath("/settings/currencies");
  return { ok: `1 ${from} = ${rate.toLocaleString("en-US")} ${co.base_currency} from ${validFrom}` };
}

export async function deleteRate(fd: FormData) {
  const user = await rateKeeper();
  await sql`delete from exchange_rate where id = ${str(fd, "id")} and company_id = ${user.companyId}`;
  revalidatePath("/settings/currencies");
}
