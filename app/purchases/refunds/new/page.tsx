import { notFound } from "next/navigation";
import { todayLocal } from "@/lib/format";
import { requirePermission } from "@/lib/auth";
import { sql } from "@/lib/db";
import { refundableOnDebitNote } from "@/lib/posting";
import { createSupplierRefund } from "@/lib/actions";
import { ErpCrumbs } from "@/components/erp-worklist";
import { HelpHint } from "@/components/help-hint";
import { SupplierRefundForm } from "@/components/supplier-refund-form";

export const metadata = { title: "Refund from supplier" };

export default async function NewSupplierRefund({ searchParams }: { searchParams: Promise<{ note?: string }> }) {
  const user = await requirePermission("purchase.post");
  const { note } = await searchParams;
  if (!note) notFound();
  const [own] = await sql`select 1 from document where id = ${note} and company_id = ${user.companyId} and doc_type = 'DEBIT_NOTE'`;
  if (!own) notFound();
  const { note: n, refundable } = await refundableOnDebitNote(sql as never, note);
  const [meta] = await sql`
    select d.doc_no, p.name as supplier, b.doc_no as bill_no from document d
      join business_partner p on p.id = d.partner_id left join document b on b.id = ${n.bill_id}
     where d.id = ${note}`;
  const accounts = await sql`
    select id, code, name from account
     where company_id = ${user.companyId} and is_cash_account and is_postable and is_active order by code`;

  return (
    <>
      <ErpCrumbs steps={[{ label: "Debit notes", href: "/purchases/debit-notes" },
        { label: meta.doc_no as string, href: `/documents/${note}` }, { label: "Refund from supplier" }]} />
      <div className="page-head">
        <span className="eyebrow">Purchases</span>
        <h1>Refund from supplier</h1>
        <HelpHint>
          The supplier pays back what the debit note left owing on a bill you had already paid. The money comes
          into the account you choose and the bill comes back to zero: Dr cash or bank / Cr Accounts Payable.
          Cost is not touched — the debit note already moved it.
        </HelpHint>
      </div>
      <SupplierRefundForm action={createSupplierRefund} noteId={note} noteNo={meta.doc_no as string}
        supplier={meta.supplier as string} billNo={(meta.bill_no as string) ?? ""} refundable={refundable}
        accounts={accounts as never} today={todayLocal()} />
    </>
  );
}
