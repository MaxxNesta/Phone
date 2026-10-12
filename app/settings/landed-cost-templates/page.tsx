import { requirePermission } from "@/lib/auth";
import { landedCostTypes, landedCostTemplates } from "@/lib/landed-cost-queries";
import { saveTemplateAction } from "@/lib/landed-cost-actions";
import { LcForm } from "@/components/landed-cost-editor";
import { HelpHint } from "@/components/help-hint";

const METHODS: [string, string][] = [
  ["VALUE", "By purchase value"], ["EQUAL", "Equal per phone"], ["MANUAL", "Manual by product variant"],
];

/** A template's charges: one row per cost type, ticked to include it. */
function Lines({ t, types }: { t?: any; types: any[] }) {
  const k = t?.id ?? "new";
  const has = new Map<string, string>((t?.lines ?? []).map((l: any) => [l.costTypeId, l.method]));
  return (
    <table className="table lc-template-lines">
      <thead><tr><th>Include</th><th>Cost type</th><th>Spread</th></tr></thead>
      <tbody>
        {types.map((ty) => (
          <tr key={ty.id}>
            <td>
              {/* Unticked rows send an empty type, which the action skips; the
                  method select is always sent so the two lists stay aligned. */}
              <select name="line_type" defaultValue={has.has(ty.id) ? ty.id : ""} aria-label={`Include ${ty.name}`}>
                <option value="">No</option>
                <option value={ty.id}>Yes</option>
              </select>
            </td>
            <td>{ty.name}</td>
            <td>
              <select name="line_method" defaultValue={has.get(ty.id) ?? ty.default_method} aria-label={`${ty.name} spread`} id={`m-${k}-${ty.id}`}>
                {METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function LandedCostTemplates() {
  const user = await requirePermission("settings.manage");
  const [templates, types] = await Promise.all([
    landedCostTemplates(user.companyId), landedCostTypes(user.companyId, true),
  ]) as any[];

  return (
    <>
      <div className="page-head hero">
        <span className="eyebrow">Settings · Purchasing</span>
        <h1>Landed cost templates</h1>
        <HelpHint>
          A template is a starting list of charges for a kind of shipment —
          which costs usually come with it and how each is spread. Choosing it
          on a landed cost fills in those charges with blank amounts. It is
          never posted itself, so changing it changes nothing already recorded.
        </HelpHint>
        <p className="page-sub">The usual charges for each kind of shipment.</p>
      </div>

      <section className="card">
        <div className="card-head"><h2>Templates</h2><span className="page-sub">{templates.length}</span></div>
        <div className="lc-settings-list">
          {templates.map((t: any) => (
            <details key={t.id} className="lc-setting">
              <summary>
                <span><strong>{t.name}</strong></span>
                <span className="wrap">{t.lines.map((l: any) => l.name).join(", ") || "No charges"}</span>
                <span>{t.is_active ? "Active" : "Inactive"}</span>
              </summary>
              <LcForm action={saveTemplateAction} submitLabel="Save changes">
                <input type="hidden" name="id" value={t.id} />
                <div className="row">
                  <div className="field">
                    <label htmlFor={`n-${t.id}`}>Name</label>
                    <input id={`n-${t.id}`} name="name" defaultValue={t.name} required />
                  </div>
                  <label className="check lc-active"><input type="checkbox" name="is_active" defaultChecked={t.is_active} /> Active</label>
                </div>
                <Lines t={t} types={types} />
              </LcForm>
            </details>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="card-head"><h2>Add a template</h2></div>
        <div className="card-body">
          <LcForm action={saveTemplateAction} submitLabel="Add template">
            <div className="field">
              <label htmlFor="n-new">Name</label>
              <input id="n-new" name="name" required placeholder="e.g. Thailand Accessories Import" />
            </div>
            <Lines types={types} />
          </LcForm>
        </div>
      </section>
    </>
  );
}
