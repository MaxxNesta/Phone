"use server";

import { revalidatePath } from "next/cache";
import { sql } from "./db";
import { requirePermission } from "./auth";
import { nameUnits } from "./phone";

/**
 * Put a handset on hold (reserved for a customer, or in repair) or release
 * it. Moves no stock: a held unit is still on the shelf and in the books, it
 * just cannot be sold until released. Hold and release are both written to
 * the unit's history.
 */
export async function setSerialHold(fd: FormData) {
  const user = await requirePermission("inventory.manage");
  const serialId = String(fd.get("serial_id") ?? "");
  const kind = String(fd.get("kind") ?? "");
  const note = String(fd.get("note") ?? "").trim() || null;

  await sql.begin(async (tx) => {
    const [s] = await tx`
      select s.id, v.status from stock_serial s join v_stock_serial v on v.serial_id = s.id
       where s.id = ${serialId} and s.company_id = ${user.companyId} for update of s`;
    if (!s) throw new Error("That unit does not exist");

    if (kind === "RELEASE") {
      await tx`update stock_serial_hold set released_at = now(), released_by = ${user.id}
                where serial_id = ${serialId} and released_at is null`;
    } else {
      if (kind !== "RESERVED" && kind !== "REPAIR") throw new Error("Choose reserve or repair");
      if (s.status !== "IN_STOCK") throw new Error("Only a unit on the shelf can be held");
      await tx`insert into stock_serial_hold (company_id, serial_id, kind, note, created_by)
               values (${user.companyId}, ${serialId}, ${kind}, ${note}, ${user.id})`;
    }
    await tx`insert into stock_serial_event (company_id, serial_id, event, note, acted_by)
             values (${user.companyId}, ${serialId}, ${kind === "RELEASE" ? "RELEASE" : "HOLD"},
                     ${kind === "RELEASE" ? note : `${kind.toLowerCase()}${note ? ": " + note : ""}`}, ${user.id})`;
  });
  revalidatePath(`/inventory/phones/${serialId}`);
}

const monthsOf = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? "").trim();
  if (v === "") return null;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 0 || n > 120) throw new Error("Warranty must be 0 to 120 months");
  return n;
};

/**
 * IMEI tracking and warranty on an item. Tracking can only change while the
 * item has never moved: switching it on with stock already on the shelf
 * would leave units no IMEI was ever recorded for.
 */
export async function setItemPhoneSettings(fd: FormData) {
  const user = await requirePermission("items.manage");
  const id = String(fd.get("id") ?? "");
  const [item] = await sql`
    select i.tracks_serial, exists (select 1 from stock_movement m where m.item_id = i.id) as moved
      from item i where i.id = ${id} and i.company_id = ${user.companyId}`;
  if (!item) throw new Error("That item does not exist");
  const wanted = fd.get("tracks_serial") !== null;
  const warranty = monthsOf(fd, "warranty_months");
  const supplierWarranty = monthsOf(fd, "supplier_warranty_months");
  // The product and every variant of it: "iPhone 16" is tracked by IMEI as a
  // whole, not one colour at a time. A variant whose stock has already moved
  // keeps what it had — its units on the shelf were never named.
  await sql`
    update item i set
           tracks_serial = case
             when exists (select 1 from stock_movement m where m.item_id = i.id) then i.tracks_serial
             else ${wanted} end,
           warranty_months = ${warranty},
           supplier_warranty_months = ${supplierWarranty}
     where i.company_id = ${user.companyId} and (i.id = ${id} or i.parent_item_id = ${id})`;
  revalidatePath(`/items/${id}`);
  revalidatePath("/products");
}

/** IMEIs for phones already on the shelf without one; see nameUnits. */
export async function nameUnitsOnShelf(
  _prev: { error?: string; ok?: string } | null, fd: FormData,
): Promise<{ error?: string; ok?: string }> {
  const user = await requirePermission("inventory.manage");
  const itemId = String(fd.get("item_id") ?? "");
  const locationId = String(fd.get("location_id") ?? "");
  const rows = String(fd.get("imeis") ?? "").split(/\r?\n/)
    .map((r) => r.split(/[\s,;]+/).filter(Boolean)).filter((p) => p.length > 0);
  const units = rows.map(([serial, imei2]) => ({ serial, imei2: imei2 ?? null }));
  if (units.length === 0) return { error: "Scan or type at least one IMEI." };
  const all = units.flatMap((u) => [u.serial, u.imei2].filter((x): x is string => !!x));
  if (new Set(all).size !== all.length) return { error: "The same IMEI is listed twice." };

  try {
    await nameUnits(user.companyId, user.id, itemId, locationId, units);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath("/inventory/phones");
  revalidatePath("/inventory/phones/name");
  return { ok: `${units.length} IMEI${units.length === 1 ? "" : "s"} recorded.` };
}
