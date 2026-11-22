"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql } from "./db";
import { requireUser, can, assertShopWritable } from "./auth";
import type { SessionUser } from "./auth-core";

/**
 * Warranty claims (0221, docs/06 D-P7): a customer is back with a phone that
 * is not working. The claim writes down what is wrong and whether the phone
 * was covered — by the shop's warranty and by the supplier's — on the day it
 * was claimed, then how it ended. It moves nothing itself; the customer
 * return into quarantine and the return to the supplier are their own
 * documents, and the claim names them.
 *
 * Whoever takes returns or manages stock may open and close a claim; anyone
 * who can see stock can read them.
 */

const OUTCOMES = ["REPAIRED", "REPLACED", "REFUNDED", "REJECTED"] as const;
export type ClaimOutcome = (typeof OUTCOMES)[number];

async function requireClaimRights(): Promise<SessionUser> {
  const user = await requireUser();
  if (!can(user, "sales.return") && !can(user, "inventory.manage")) {
    throw new Error("Only someone who takes returns or manages stock can record a warranty claim.");
  }
  // Checks rights its own way, so it asks about read-only itself.
  await assertShopWritable();
  return user;
}

/**
 * The phone's warranty position today, for the claim form and for the claim
 * itself: the last sale of the unit (it may already be back with us), what
 * that sale promised, and what the supplier's warranty runs to.
 */
export type ClaimPosition = Record<string, any> & { today: string; in_warranty: boolean; supplier_in_warranty: boolean };

export async function claimPositionFor(serialId: string): Promise<ClaimPosition | null> {
  const user = await requireUser();
  if (!can(user, "inventory.view")) throw new Error("You cannot see stock.");
  const [u] = await sql`
    select v.serial_id, v.imei, v.item_id, v.item_code, v.item_name, v.status, v.location_id,
           v.supplier_id, v.supplier_name, v.received_date,
           v.supplier_warranty_months,
           case when v.received_date is not null and v.supplier_warranty_months is not null
                then (v.received_date + make_interval(months => v.supplier_warranty_months))::date end
             as supplier_warranty_until,
           sale.id as sale_id, sale.doc_no as sale_no, sale.posting_date as sold_on,
           sale.partner_id as customer_id, bp.name as customer_name, sale.location_id as sale_location_id,
           sl.warranty_months,
           case when sl.warranty_months is not null
                then (sale.posting_date + make_interval(months => sl.warranty_months))::date end
             as warranty_until,
           sl.unit_price as sold_at
      from v_stock_serial v
      left join lateral (
        select d.* from stock_serial_event e
          join document d on d.id = e.document_id
         where e.serial_id = v.serial_id and e.event = 'SOLD' and d.status = 'POSTED'
         order by e.created_at desc limit 1) sale on true
      left join lateral (
        select dl.warranty_months,
               (dl.net_amount / nullif(dl.base_qty, 0))::float as unit_price
          from document_line dl
         where dl.document_id = sale.id and dl.item_id = v.item_id
         order by dl.line_no limit 1) sl on true
      left join business_partner bp on bp.id = sale.partner_id
     where v.serial_id = ${serialId} and v.company_id = ${user.companyId}`;
  if (!u) return null;
  const [{ today }] = await sql`select fn_shop_today()::text as today`;
  const covered = (until: unknown) => !!until && String(until) >= String(today);
  return {
    ...u,
    today: String(today),
    in_warranty: covered(u.warranty_until),
    supplier_in_warranty: covered(u.supplier_warranty_until),
  };
}

/** Opens a claim on a sold phone. One open claim per phone. */
export async function openWarrantyClaim(_prev: unknown, fd: FormData): Promise<{ error: string } | void> {
  const user = await requireClaimRights();
  const serialId = String(fd.get("serial_id") ?? "");
  const fault = String(fd.get("fault") ?? "").trim();
  if (!fault) return { error: "Say what is wrong with the phone." };

  let claimId = "";
  try {
    const pos = await claimPositionFor(serialId);
    if (!pos) return { error: "That phone is not on file." };
    if (!pos.sale_id) return { error: `${pos.imei} has never been sold, so there is no customer to claim for it.` };

    claimId = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext('warranty_claim:' || ${user.companyId}))`;
      const [open] = await tx`
        select claim_no from warranty_claim
         where serial_id = ${serialId} and status = 'OPEN' and company_id = ${user.companyId}`;
      if (open) throw new Error(`${pos.imei} already has an open claim, ${open.claim_no}.`);
      const [{ n }] = await tx`select count(*)::int + 1 as n from warranty_claim where company_id = ${user.companyId}`;
      const claimNo = `WC${String(n).padStart(5, "0")}`;
      const [c] = await tx`
        insert into warranty_claim
          (company_id, claim_no, serial_id, item_id, partner_id, sale_document_id, location_id, fault,
           claimed_on, warranty_until, in_warranty, supplier_id, supplier_warranty_until, supplier_in_warranty,
           created_by)
        values
          (${user.companyId}, ${claimNo}, ${serialId}, ${pos.item_id}, ${pos.customer_id ?? null},
           ${pos.sale_id}, ${pos.sale_location_id ?? null}, ${fault},
           ${pos.today}::date, ${pos.warranty_until ?? null}, ${pos.in_warranty},
           ${pos.supplier_id ?? null}, ${pos.supplier_warranty_until ?? null}, ${pos.supplier_in_warranty},
           ${user.id})
        returning id`;
      await tx`insert into stock_serial_event (company_id, serial_id, event, note, acted_by)
               values (${user.companyId}, ${serialId}, 'CLAIM_OPENED', ${`${claimNo}: ${fault}`}, ${user.id})`;
      return c.id as string;
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath("/inventory/warranty");
  revalidatePath(`/imei/${serialId}`);
  redirect(`/inventory/warranty/claims/${claimId}`);
}

/** Closes a claim with how it ended. */
export async function closeWarrantyClaim(_prev: unknown, fd: FormData): Promise<{ error: string } | void> {
  const user = await requireClaimRights();
  const id = String(fd.get("claim_id") ?? "");
  const outcome = String(fd.get("outcome") ?? "") as ClaimOutcome;
  const note = String(fd.get("note") ?? "").trim() || null;
  if (!OUTCOMES.includes(outcome)) return { error: "Choose how the claim ended." };
  if (outcome === "REJECTED" && !note) return { error: "Say why the claim was turned down." };
  try {
    await sql.begin(async (tx) => {
      const [c] = await tx`
        select id, claim_no, serial_id, status from warranty_claim
         where id = ${id} and company_id = ${user.companyId} for update`;
      if (!c) throw new Error("That claim does not exist.");
      if (c.status !== "OPEN") throw new Error(`${c.claim_no} is already closed.`);
      await tx`update warranty_claim
                  set status = 'CLOSED', outcome = ${outcome}, outcome_note = ${note},
                      closed_by = ${user.id}, closed_at = now()
                where id = ${id}`;
      await tx`insert into stock_serial_event (company_id, serial_id, event, note, acted_by)
               values (${user.companyId}, ${c.serial_id}, 'CLAIM_CLOSED',
                       ${`${c.claim_no}: ${outcome.toLowerCase()}${note ? " — " + note : ""}`}, ${user.id})`;
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath(`/inventory/warranty/claims/${id}`);
  revalidatePath("/inventory/warranty");
}
