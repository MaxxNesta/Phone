import { requirePermission } from "@/lib/auth";
import { sql } from "@/lib/db";
import { listShareholders, shareFormState } from "@/lib/shares";
import { postShareTransferAction } from "@/lib/share-actions";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { HelpHint } from "@/components/help-hint";
import { ShareTransferForm } from "@/components/share-transfer-form";

export const metadata = { title: "New share transfer" };

export default async function NewShareTransfer() {
  const user = await requirePermission("accounting.post");
  const [holders, state, equity, money] = await Promise.all([
    listShareholders(user.companyId),
    shareFormState(user.companyId),
    sql`select id, code, name from account where company_id = ${user.companyId} and account_type in ('EQUITY', 'LIABILITY') and is_postable and is_active order by code`,
    sql`select id, code, name from account where company_id = ${user.companyId} and (is_cash_account or is_bank_account) and is_active order by code`,
  ]);
  return (
    <div className="ie">
      <Breadcrumbs trail={[{ label: "Shareholders", href: "/equity/shareholders" }, { label: "Share transfers", href: "/equity/transfers" }, { label: "New share transfer" }]} />
      <header className="ie-title"><h1>New share transfer <HelpHint label="About share transfers">Issue gives new shares to a shareholder; Transfer moves held shares between shareholders; Purchase buys shares back. Share numbers are ranges and must be free (an issue) or held by the giver on the date (a transfer or purchase).</HelpHint></h1></header>
      <ShareTransferForm action={postShareTransferAction}
        holders={holders.map((h) => ({ id: h.id, code: h.code, name: h.name, folio_no: h.folio_no, is_active: h.is_active }))}
        holdings={state.holdings as never} nextIssueNo={state.nextIssueNo}
        equityAccounts={equity as never} assetAccounts={money as never} today={new Date().toISOString().slice(0, 10)} />
    </div>
  );
}
