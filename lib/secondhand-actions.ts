"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { sql } from "./db";
import { str, num } from "./input";
import { requirePermission, can } from "./auth";
import { assertMyBranch } from "./branch-scope";
import { postOnce } from "./idempotency";
import { postSecondhandBuy, postTradeIn, previousSaleOf, type Inspection, type Seller } from "./secondhand";
import type { ActionResult } from "./actions";

const company = async () => (await sql`select id from company order by created_at limit 1`)[0].id as string;
const key = (fd: FormData) => { const k = str(fd, "idempotency_key"); return k && k.length <= 100 ? k : null; };
function done(path: string, msg: string): never { redirect(`${path}?toast=${encodeURIComponent(msg)}`); }

function sellerFrom(fd: FormData): Seller {
  return { kind: str(fd, "seller_kind") === "SHOP" ? "SHOP" : "CUSTOMER", partnerId: str(fd, "partner_id") || null,
           name: str(fd, "seller_name"), phone: str(fd, "seller_phone"), nrc: str(fd, "seller_nrc") || null };
}
function inspectionFrom(fd: FormData): Inspection {
  let checks: Record<string, string> = {};
  try { checks = JSON.parse(str(fd, "checks") || "{}"); } catch { /* none */ }
  return { grade: str(fd, "grade") || "B", batteryPct: fd.get("battery_pct") ? num(fd, "battery_pct") : null,
           activationLock: str(fd, "activation_lock") === "PRESENT" ? "PRESENT" : "REMOVED",
           checks, notes: str(fd, "notes") || null };
}

/** For the forms: what an IMEI is to us — on a shelf, sold before, or new. */
export async function lookupImei(imei: string) {
  const user = await requirePermission("sales.view");
  const co = user.companyId;
  const prev = await previousSaleOf(sql as never, co, imei);
  const [unit] = await sql`
    select v.serial_id, v.item_id, coalesce(v.model_name, v.item_name) as model, v.item_name,
           (select ip.price from item_price ip join price_level pl on pl.id = ip.price_level_id
             where ip.item_id = v.item_id and ip.valid_from <= fn_shop_today()
             order by (pl.code = 'RETAIL') desc, ip.valid_from desc limit 1)::float as price,
           exists (select 1 from secondhand_intake i where i.serial_id = v.serial_id
                                                    and i.receipt_id = v.received_document_id) as used,
           v.location_id
      from v_stock_serial v where v.company_id = ${co} and v.imei = ${imei.trim()}`;
  return {
    onShelf: !!prev?.on_shelf, unit: unit ?? null,
    previousSale: prev?.id ? { id: prev.id, docNo: prev.doc_no, date: prev.date, branch: prev.branch } : null,
  };
}

export async function createSecondhandBuy(_prev: unknown, fd: FormData): Promise<ActionResult> {
  const user = await requirePermission("purchase.post");
  let billId = "";
  try {
    const co = await company();
    const locationId = str(fd, "location_id");
    await assertMyBranch(locationId);
    const r = await postOnce(co, key(fd), async (tx) => {
      const b = await postSecondhandBuy(tx, {
        companyId: co, userId: user.id, locationId, docDate: str(fd, "doc_date"),
        seller: sellerFrom(fd), itemId: str(fd, "item_id"), imei: str(fd, "imei"), price: num(fd, "price"),
        inspection: inspectionFrom(fd),
        cashAccountId: str(fd, "payment") === "NOW" ? str(fd, "cash_account_id") || null : null,
      });
      return { id: b.billId, docNo: b.billNo };
    });
    billId = r.id;
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath("/documents");
  return done(`/documents/${billId}`, "Secondhand phone received");
}

export async function createTradeIn(_prev: unknown, fd: FormData): Promise<ActionResult> {
  const user = await requirePermission("sales.post");
  let saleId = "";
  try {
    const co = await company();
    const locationId = str(fd, "location_id");
    await assertMyBranch(locationId);
    const r = await postOnce(co, key(fd), async (tx) => {
      const t = await postTradeIn(tx, {
        companyId: co, userId: user.id, locationId, docDate: str(fd, "doc_date"),
        seller: sellerFrom(fd), itemId: str(fd, "item_id"), imei: str(fd, "imei"),
        inspection: inspectionFrom(fd),
        inspectedValue: num(fd, "inspected_value"), topUp: num(fd, "top_up"),
        newItemId: str(fd, "new_item_id"), newImei: str(fd, "new_imei"), newPrice: num(fd, "new_price"),
        cashAccountId: str(fd, "cash_account_id"),
        // Paying money out to a customer is a purchase decision.
        payExcess: fd.get("pay_excess") === "on" && can(user, "purchase.post"),
      });
      return { id: t.id, docNo: t.docNo };
    });
    saleId = r.id;
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath("/documents");
  return done(`/documents/${saleId}`, "Trade-in posted");
}
