import { sql } from "./db";
import { can, type SessionUser } from "./auth-core";
import {
  sanitizeConfig, defaultConfig, type Paper, type ReceiptConfig, type ReceiptData, type ReceiptIdentity,
} from "./receipt-config";

export type { ReceiptData, ReceiptIdentity } from "./receipt-config";

/** A sale, the template it is drawn with, and who sold it. */
export type ReceiptView = {
  data: ReceiptData;
  paper: Paper;
  config: ReceiptConfig;
  identity: ReceiptIdentity;
  template: { id: string; name: string; version: number } | null;
};

const addMonths = (iso: string, months: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
};

/**
 * One sales receipt, read from the posted sale. `locs` limits it to the
 * person's own branch (null sees every one); a receipt of another company, or
 * outside that, comes back null. Reads only: nothing about the sale changes.
 */
export async function getReceipt(companyId: string, id: string, locs: string[] | null): Promise<ReceiptData | null> {
  const [doc] = await sql`
    select d.id, d.doc_no, d.version, d.posting_date::text as posting_date,
           to_char(d.posted_at at time zone coalesce(c.timezone, 'Asia/Yangon'), 'HH24:MI') as posted_time,
           d.net_total::float as net_total, d.tax_total::float as tax_total, d.gross_total::float as gross_total,
           d.status, d.memo, bp.name as customer, sm.name as salesman, u.name as cashier
      from document d
      join company c on c.id = d.company_id
      left join business_partner bp on bp.id = d.partner_id
      left join salesman sm on sm.id = d.salesman_id
      left join app_user u on u.id = d.posted_by_id
     where d.id = ${id} and d.company_id = ${companyId} and d.doc_type = 'SALES_INVOICE'
       ${locs ? sql`and d.location_id = any(${locs})` : sql``}`;
  if (!doc) return null;

  const [lines, paid] = await Promise.all([
    sql`
      select dl.line_no, i.name as item_name, coalesce(pi.name, i.name) as product_name,
             (select string_agg(o.name, ' · ' order by a.sort_order, o.sort_order)
                from item_variant_option iv join variant_option o on o.id = iv.option_id
                join variant_attribute a on a.id = o.attribute_id
               where iv.item_id = i.id) as variant,
             dl.entered_qty::float as qty, dl.unit_price::float as price,
             dl.net_amount::float + dl.tax_amount::float as amount, dl.warranty_months,
             coalesce(dl.discount_pct, 0)::float as discount_pct, fr.name as free_reason,
             -- What a free line would have cost the customer, from the price list,
             -- so the slip can say what was given.
             case when dl.foc_reason_id is not null then (
               select ip.price::float from item_price ip join price_level pl on pl.id = ip.price_level_id
                where ip.item_id = dl.item_id and pl.code = 'RETAIL' and ip.valid_from <= current_date
                order by ip.valid_from desc limit 1) end as list_price,
             coalesce((select array_agg(s.serial_no order by s.serial_no) from stock_movement sm
                join stock_serial_issue si on si.stock_movement_id = sm.id
                join stock_serial s on s.id = si.serial_id
               where sm.document_line_id = dl.id), '{}') as imeis
        from document_line dl join item i on i.id = dl.item_id
        left join item pi on pi.id = i.parent_item_id
        left join foc_reason fr on fr.id = dl.foc_reason_id
       where dl.document_id = ${id} order by dl.line_no`,
    sql`
      select coalesce(pc.name, a.name) as name, pa.amount::float as amount
        from payment_allocation pa
        join document r on r.id = pa.payment_id and r.status = 'POSTED' and r.doc_type = 'CUSTOMER_RECEIPT'
        join journal_line jl on jl.journal_entry_id = r.journal_entry_id and jl.base_amount > 0
        join account a on a.id = jl.account_id
        left join payment_channel pc on pc.id = r.payment_channel_id
       where pa.invoice_id = ${id}`,
  ]);

  const paidTotal = paid.reduce((s, p) => s + Number(p.amount), 0);
  const onAccount = Math.max(0, Number(doc.gross_total) - paidTotal);
  // Before discount, the charged lines only; free lines are counted apart.
  const charged = lines.filter((l) => !l.free_reason);
  const free = lines.filter((l) => l.free_reason);
  // How it was paid: by payment channel (0141). Sales from before channels
  // carry QR or card in the memo, and otherwise the account's name.
  const memo = String(doc.memo ?? "");
  const method = /\bQR\b/.test(memo) ? "QR" : /card/i.test(memo) ? "Card"
    : paid.length > 0 ? [...new Set(paid.map((p) => String(p.name)))].join(" + ") : "Credit (on account)";

  return {
    docNo: doc.doc_no, version: Number(doc.version), status: doc.status,
    date: doc.posting_date, time: doc.posted_time ?? null,
    customer: doc.customer, salesman: doc.salesman, cashier: doc.cashier,
    paymentMethod: paid.length > 0 && onAccount > 0.005 ? `${method} + on account` : method,
    net: doc.net_total, tax: doc.tax_total, total: doc.gross_total,
    subtotal: charged.reduce((s, l) => s + Number(l.qty) * Number(l.price), 0),
    discount: charged.reduce((s, l) => s + Number(l.qty) * Number(l.price) * Number(l.discount_pct) / 100, 0),
    freeCount: free.reduce((s, l) => s + Number(l.qty), 0),
    freeValue: free.reduce((s, l) => s + Number(l.qty) * Number(l.list_price ?? 0), 0),
    lines: lines.map((l) => ({
      lineNo: l.line_no, productName: l.product_name, itemName: l.item_name, variant: l.variant ?? null,
      qty: Number(l.qty), unitPrice: Number(l.price), discountPct: Number(l.discount_pct), amount: Number(l.amount),
      imeis: (l.imeis as string[]) ?? [],
      warrantyMonths: l.warranty_months ?? null,
      // Starts the day the customer bought it; only where the sale carried one.
      warrantyEnd: l.warranty_months ? addMonths(doc.posting_date, Number(l.warranty_months)) : null,
      freeReason: l.free_reason,
    })),
    paid: paid.map((p) => ({ name: p.name, amount: Number(p.amount) })),
    onAccount,
  };
}

/**
 * Who may change a receipt template. An administrator, any. A manager, only
 * their own branch's — never the company's own template, never another
 * branch's. Cashiers, none.
 */
export function mayEditReceiptTemplate(u: Pick<SessionUser, "role" | "branchId">, branchId: string | null): boolean {
  if (can(u, "settings.manage")) return true;
  return can(u, "receipts.manage") && Boolean(u.branchId) && branchId === u.branchId;
}

/** The branch a sale belongs to: the branch its warehouse sits under. */
async function branchOfSale(id: string): Promise<string | null> {
  const [r] = await sql`
    select coalesce(l.parent_id, l.id) as branch_id
      from document d join location l on l.id = d.location_id where d.id = ${id}`;
  return (r?.branch_id as string) ?? null;
}

/** Who sold it, from the company and branch records as they stand now. */
export async function currentIdentity(companyId: string, branchId: string | null): Promise<ReceiptIdentity> {
  const [c] = await sql`select name, address, phone, logo is not null as has_logo from company where id = ${companyId}`;
  const [b] = branchId
    ? await sql`select name, address, phone from location where id = ${branchId} and company_id = ${companyId}`
    : [];
  return {
    companyName: c?.name ?? "", branchName: b?.name ?? null,
    // The branch's own address and phone, or the company's where it has none.
    address: b?.address || c?.address || null,
    phone: b?.phone || c?.phone || null,
    hasLogo: Boolean(c?.has_logo),
  };
}

/**
 * The published template a sale at this branch is printed with: the branch's
 * own default first, the company's default otherwise. Inactive templates and
 * drafts never print a sale. Null when there is none: the built-in receipt.
 */
export async function resolveTemplate(companyId: string, branchId: string | null) {
  const [t] = await sql`
    select t.id, t.name, t.published_version as version, v.paper, v.config
      from receipt_template t
      join receipt_template_version v on v.template_id = t.id and v.version = t.published_version
     where t.company_id = ${companyId} and t.is_active and t.is_default
       and (t.branch_id is null or t.branch_id = ${branchId})
     order by (t.branch_id is null), t.created_at
     limit 1`;
  return t
    ? { id: t.id as string, name: t.name as string, version: Number(t.version), paper: t.paper as Paper, config: t.config }
    : null;
}

/**
 * A sale as its receipt shows it.
 *
 * The first time a sale's receipt is drawn (the Sale complete sheet, right
 * after posting) it is pinned: the template version and the business details
 * of that moment are kept in sale_receipt. Every reprint after that reads the
 * pin, so a later template change or a new address does not redraw a receipt
 * a customer already holds. `bind: false` looks without pinning.
 */
export async function receiptView(companyId: string, id: string, locs: string[] | null,
  opts: { bind?: boolean } = {}): Promise<ReceiptView | null> {
  const data = await getReceipt(companyId, id, locs);
  if (!data) return null;

  let [pin] = await sql`
    select template_id, template_version, identity from sale_receipt where document_id = ${id} and company_id = ${companyId}`;
  if (!pin) {
    const branchId = await branchOfSale(id);
    const resolved = await resolveTemplate(companyId, branchId);
    const identity = await currentIdentity(companyId, branchId);
    if (!opts.bind) {
      const paper = resolved?.paper ?? "80";
      return {
        data, paper, config: sanitizeConfig(resolved?.config ?? defaultConfig(paper), paper), identity,
        template: resolved ? { id: resolved.id, name: resolved.name, version: resolved.version } : null,
      };
    }
    await sql`
      insert into sale_receipt (document_id, company_id, template_id, template_version, identity)
      values (${id}, ${companyId}, ${resolved?.id ?? null}, ${resolved?.version ?? null}, ${sql.json(identity as never)})
      on conflict (document_id) do nothing`;
    [pin] = await sql`
      select template_id, template_version, identity from sale_receipt where document_id = ${id}`;
  }

  const [v] = pin.template_id
    ? await sql`
        select t.name, v.paper, v.config from receipt_template_version v join receipt_template t on t.id = v.template_id
         where v.template_id = ${pin.template_id} and v.version = ${pin.template_version}`
    : [];
  const paper = (v?.paper as Paper) ?? "80";
  // The logo is the company's current image, not a copy kept per sale: a
  // receipt printed with one still reprints with it, but one whose logo has
  // since been removed reprints without, rather than asking for a missing file.
  const pinned = pin.identity as ReceiptIdentity;
  const [now] = pinned.hasLogo
    ? await sql`select logo is not null as has from company where id = ${companyId}`
    : [];
  return {
    data, paper, config: sanitizeConfig(v?.config ?? defaultConfig(paper), paper),
    identity: { ...pinned, hasLogo: pinned.hasLogo && Boolean(now?.has) },
    template: v ? { id: pin.template_id, name: v.name, version: Number(pin.template_version) } : null,
  };
}
