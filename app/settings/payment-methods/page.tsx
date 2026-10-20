import { sql } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { HelpHint } from "@/components/help-hint";
import { PaymentChannelRow, NewChannelForm, type ChannelRow } from "@/components/payment-channel-row";
import {
  createPaymentChannel, updatePaymentChannel, setPaymentChannelActive, deletePaymentChannel,
} from "@/lib/payment-channel-actions";

export const metadata = { title: "Payment methods" };

export default async function PaymentMethods() {
  const user = await requirePermission("settings.manage");
  const co = user.companyId;

  const [channels, accounts, branches] = await Promise.all([
    sql`
      select c.id, c.code, c.name, c.kind, c.is_active, c.requires_reference, c.merchant_name, c.merchant_number,
             c.sort_order, d.account_id as default_account_id, a.code || ' · ' || a.name as default_account,
             coalesce((select json_object_agg(m.branch_id, m.account_id) from payment_channel_account m
                        where m.channel_id = c.id and m.branch_id is not null), '{}') as branch_accounts,
             (select count(*)::int from document x where x.payment_channel_id = c.id) as used
        from payment_channel c
        left join payment_channel_account d on d.channel_id = c.id and d.branch_id is null
        left join account a on a.id = d.account_id
       where c.company_id = ${co}
       order by c.is_active desc, c.sort_order, c.name`,
    sql`select id, code, name from account
         where company_id = ${co} and is_cash_account and is_postable and is_active order by code`,
    sql`select id, code, name from location where company_id = ${co} and parent_id is null and is_active order by code`,
  ]);

  return (
    <>
      <div className="page-head hero">
        <span className="eyebrow">Settings · Finance</span>
        <h1>Payment methods</h1>
        <HelpHint>
          How customers pay, and which cash or bank account each method&rsquo;s money lands in.
          The till and customer receipts offer the active methods that have an account. A branch
          can pay into its own account. Wallet money moved to the bank later is a transfer
          (Finance → Transfer); it is not new revenue. A method that has been used cannot be
          deleted, only deactivated, so past receipts keep their label.
        </HelpHint>
        <p className="page-sub">Cash, bank transfer, card and mobile wallets such as KBZPay, AYA Pay, WavePay and MMQR.</p>
      </div>

      <section>
        <div className="card">
          <div className="card-head">
            <h2>Methods</h2>
            <NewChannelForm action={createPaymentChannel} accounts={accounts as never} />
          </div>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th><th>Kind</th><th>Receiving account</th><th>Transaction ID</th>
                  <th>Merchant</th><th className="r">Payments</th><th>Status</th><th />
                </tr>
              </thead>
              <tbody>
                {(channels as unknown as ChannelRow[]).map((c) => (
                  <PaymentChannelRow key={c.id} c={c} accounts={accounts as never} branches={branches as never}
                    update={updatePaymentChannel} setActive={setPaymentChannelActive} remove={deletePaymentChannel} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  );
}
