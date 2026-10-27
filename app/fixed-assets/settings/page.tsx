import { requirePermission, can } from "@/lib/auth";
import { sql } from "@/lib/db";
import { saveFaSettings, saveFaCategory } from "@/lib/fa-actions";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { FaSettingsForm, FaCategoryForm } from "@/components/fa-settings-forms";

export const metadata = { title: "Fixed Asset Settings" };

/**
 * How depreciation posts, when it starts, where disposals land, and which
 * accounts each category moves. Postings read these; nothing here rewrites
 * a posted journal.
 */
export default async function FaSettings() {
  const user = await requirePermission("accounting.view");
  const co = user.companyId;
  const canEdit = can(user, "settings.manage");
  const [[s], cats, accts] = await Promise.all([
    sql`select posting_mode, start_convention, gain_account_id, loss_account_id from fa_setting where company_id = ${co}`,
    sql`select c.*, a.code as a_code, x.code as x_code, e.code as e_code,
               exists (select 1 from fa_depreciation d join fixed_asset f on f.id = d.asset_id where f.category_id = c.id and d.journal_line_id is not null)
            or exists (select 1 from fa_journal_link k join fixed_asset f on f.id = k.asset_id where f.category_id = c.id) as used,
               (select count(*)::int from fixed_asset f where f.category_id = c.id) as assets
          from fa_category c join account a on a.id = c.asset_account_id join account x on x.id = c.accum_account_id
          join account e on e.id = c.expense_account_id
         where c.company_id = ${co} order by c.asset_class, c.code`,
    sql`select id, code, name, account_type from account
         where company_id = ${co} and is_postable and is_active and not is_cash_account and not is_bank_account and not is_control
           and account_type in ('ASSET', 'EXPENSE', 'REVENUE') order by code`,
  ]);
  const list = (t: string) => (accts as any[]).filter((a) => a.account_type === t);
  const setting = s ?? { posting_mode: "REVIEW", start_convention: "NEXT_MONTH", gain_account_id: null, loss_account_id: null };

  return (
    <div className="ie">
      <Breadcrumbs trail={[{ label: "Fixed Assets", href: "/fixed-assets" }, { label: "Settings" }]} />
      <header className="ie-title">
        <h1>Fixed Asset Settings</h1>
        <p>How depreciation posts, and which accounts each category moves in the ledger.</p>
      </header>
      <div className="fas">
        <section className="ie-card">
          <h3>Depreciation &amp; posting</h3>
          {canEdit ? <FaSettingsForm action={saveFaSettings} value={setting as never} revenue={list("REVENUE")} expense={list("EXPENSE")} />
            : <p className="fa-muted">Only someone who manages settings can change these.</p>}
        </section>

        <section className="ie-card">
          <h3>Categories and their accounts</h3>
          <p className="ie-note" style={{ marginTop: 0 }}>Each category posts depreciation as a debit to its expense account and a credit to its accumulated-depreciation account; its assets sit on the asset account.</p>
          <div className="fas-cats">
            {(cats as any[]).map((c) => (
              <details key={c.id} className="fas-row">
                <summary>
                  <strong>{c.name}</strong>
                  <span className="mono">{c.a_code} · {c.x_code} · {c.e_code}</span>
                  <span>{c.asset_class === "INTANGIBLE" ? "Amortised" : "Depreciated"} · {c.assets} asset{c.assets === 1 ? "" : "s"}{c.is_active ? "" : " · inactive"}</span>
                </summary>
                {canEdit && <FaCategoryForm action={saveFaCategory} used={c.used} assets={list("ASSET")} expenses={list("EXPENSE")}
                  value={{ id: c.id, code: c.code, name: c.name, asset_class: c.asset_class, asset_account_id: c.asset_account_id,
                           accum_account_id: c.accum_account_id, expense_account_id: c.expense_account_id,
                           default_life_months: c.default_life_months, is_active: c.is_active }} />}
              </details>
            ))}
            {canEdit && (
              <details className="fas-row">
                <summary><strong>Add a category</strong><span /><span>For a class of asset the chart already has accounts for</span></summary>
                <FaCategoryForm action={saveFaCategory} used={false} assets={list("ASSET")} expenses={list("EXPENSE")}
                  value={{ code: "", name: "", asset_class: "TANGIBLE", asset_account_id: "", accum_account_id: "", expense_account_id: "", default_life_months: null, is_active: true }} />
              </details>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
