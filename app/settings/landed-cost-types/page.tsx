import { sql } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { landedCostTypes } from "@/lib/landed-cost-queries";
import { saveCostTypeAction } from "@/lib/landed-cost-actions";
import { LcForm } from "@/components/landed-cost-editor";
import { HelpHint } from "@/components/help-hint";

const METHODS: [string, string][] = [
  ["VALUE", "By purchase value"], ["EQUAL", "Equal per phone"], ["MANUAL", "Manual by product variant"],
];

function Fields({ t, accounts, partners, currencies }: { t?: any; accounts: any[]; partners: any[]; currencies: any[] }) {
  const k = t?.id ?? "new";
  return (
    <>
      {t && <input type="hidden" name="id" value={t.id} />}
      <div className="row">
        <div className="field">
          <label htmlFor={`code-${k}`}>Code</label>
          <input id={`code-${k}`} name="code" defaultValue={t?.code ?? ""} required placeholder="FREIGHT" autoCapitalize="characters" />
        </div>
        <div className="field">
          <label htmlFor={`name-${k}`}>Name</label>
          <input id={`name-${k}`} name="name" defaultValue={t?.name ?? ""} required placeholder="International Freight" />
        </div>
        <div className="field">
          <label htmlFor={`method-${k}`}>Spread by default</label>
          <select id={`method-${k}`} name="default_method" defaultValue={t?.default_method ?? "VALUE"}>
            {METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </div>
      <div className="row">
        <div className="field">
          <label htmlFor={`acct-${k}`}>Clearing account</label>
          <select id={`acct-${k}`} name="clearing_account_id" defaultValue={t?.clearing_account_id ?? ""}>
            <option value="">Landed Cost Clearing (default)</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`partner-${k}`}>Usual supplier <span className="opt">optional</span></label>
          <select id={`partner-${k}`} name="default_partner_id" defaultValue={t?.default_partner_id ?? ""}>
            <option value="">—</option>
            {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`cur-${k}`}>Usual currency <span className="opt">optional</span></label>
          <select id={`cur-${k}`} name="default_currency" defaultValue={t?.default_currency ?? ""}>
            <option value="">Company currency</option>
            {currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
          </select>
        </div>
        {t && (
          <label className="check lc-active">
            <input type="checkbox" name="is_active" defaultChecked={t.is_active} /> Active
          </label>
        )}
      </div>
    </>
  );
}

export default async function LandedCostTypes() {
  const user = await requirePermission("settings.manage");
  const [types, accounts, partners, currencies] = await Promise.all([
    landedCostTypes(user.companyId),
    sql`select id, code || ' ' || name as label from account where company_id = ${user.companyId}
          and account_type = 'ASSET' and is_postable and coalesce(is_active, true) order by code`,
    sql`select id, name from business_partner where company_id = ${user.companyId} and is_supplier and is_active order by name`,
    sql`select code from currency order by code`,
  ]) as any[];

  return (
    <>
      <div className="page-head hero">
        <span className="eyebrow">Settings · Purchasing</span>
        <h1>Landed cost types</h1>
        <HelpHint>
          The kinds of cost that come with imported goods. Each has the way it
          is usually spread over the phones and the account its bills wait in
          until a landed cost spreads them. A landed cost can change either
          for one charge; this is only the starting point.
        </HelpHint>
        <p className="page-sub">Freight, duty and the other costs of bringing phones in.</p>
      </div>

      <section className="card">
        <div className="card-head"><h2>Types</h2><span className="page-sub">{types.length}</span></div>
        <div className="lc-settings-list">
          {types.map((t: any) => (
            <details key={t.id} className="lc-setting">
              <summary>
                <span><strong>{t.name}</strong> <span className="m lc-count">{t.code}</span></span>
                <span>{METHODS.find(([v]) => v === t.default_method)?.[1]}</span>
                <span className="m">{t.clearing_account ?? "Landed Cost Clearing"}</span>
                <span>{t.is_active ? "Active" : "Inactive"}</span>
              </summary>
              <LcForm action={saveCostTypeAction} submitLabel="Save changes">
                <Fields t={t} accounts={accounts} partners={partners} currencies={currencies} />
              </LcForm>
            </details>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="card-head"><h2>Add a type</h2></div>
        <div className="card-body">
          <LcForm action={saveCostTypeAction} submitLabel="Add type">
            <Fields accounts={accounts} partners={partners} currencies={currencies} />
          </LcForm>
        </div>
      </section>
    </>
  );
}
