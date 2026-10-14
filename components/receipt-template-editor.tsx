"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Printer, Plus } from "lucide-react";
import {
  PAPERS, PAPER_LABEL, WIDTH, SAMPLE_RECEIPT, SAMPLE_IDENTITY, TEXT_LIMITS, sanitizeConfig,
  type Paper, type ReceiptConfig, type ReceiptData, type ReceiptIdentity,
} from "@/lib/receipt-config";
import {
  createReceiptTemplate, saveReceiptDraft, publishReceiptTemplate, setDefaultReceiptTemplate,
  setReceiptTemplateActive, saveCompanyContact, uploadCompanyLogo, removeCompanyLogo, previewSaleData,
} from "@/lib/receipt-template-actions";
import { money, shortDate } from "@/lib/format";
import { HelpHint } from "./help-hint";
import { ReceiptSlip } from "./receipt-slip";
import { ReceiptPrintHost } from "./receipt-print";

export type TemplateRow = {
  id: string; name: string; paper: Paper; branchId: string | null; branchName: string | null;
  isActive: boolean; isDefault: boolean;
  publishedVersion: number | null; publishedAt: string | null; publishedBy: string | null;
  draft: ReceiptConfig; dirty: boolean; canEdit: boolean;
  versions: Array<{ version: number; paper: Paper; publishedAt: string; publishedBy: string | null }>;
  audit: Array<{ action: string; at: string; by: string | null; detail: unknown }>;
};
type Branch = { id: string; name: string; address: string | null; phone: string | null };
type Company = { name: string; address: string | null; phone: string | null; hasLogo: boolean };
type Sale = { id: string; docNo: string; date: string; total: number };
type Result = { error?: string; ok?: string; id?: string; version?: number } | null;
type Tab = "general" | "design" | "preview";

const ACTION_LABEL: Record<string, string> = {
  CREATE: "Created", SAVE_DRAFT: "Draft saved", PUBLISH: "Published", SET_DEFAULT: "Made default",
  ACTIVATE: "Turned on", DEACTIVATE: "Turned off",
};
const when = (s: string) => new Date(s).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/**
 * Settings → POS Settings → Receipt Templates. A list of templates beside the
 * one being edited, its settings beside a live preview. Edits stay a draft
 * until published; sales print the published version only.
 */
export function ReceiptTemplateEditor({ templates, isAdmin, myBranchId, branches, company, sales }: {
  templates: TemplateRow[]; isAdmin: boolean; myBranchId: string | null;
  branches: Branch[]; company: Company; sales: Sale[];
}) {
  const [selId, setSelId] = useState<string | null>(templates[0]?.id ?? null);
  const [adding, setAdding] = useState(templates.length === 0);
  const sel = templates.find((t) => t.id === selId) ?? null;

  const groups = useMemo(() => {
    const m = new Map<string, { label: string; rows: TemplateRow[] }>();
    for (const t of templates) {
      const k = t.branchId ?? "";
      if (!m.has(k)) m.set(k, { label: t.branchName ?? "Company-wide", rows: [] });
      m.get(k)!.rows.push(t);
    }
    return [...m.values()];
  }, [templates]);

  return (
    <div className="rt">
      <div className="page-head">
        <h1>Receipt Templates</h1>
        <HelpHint label="About receipt templates">
          What a counter sale’s receipt shows and how it prints. A branch’s default overrides the company’s.
          Changes stay a draft until you publish them; receipts already printed keep the version they were printed with.
        </HelpHint>
      </div>

      <div className="rt-layout">
        <aside className="card rt-list" aria-label="Templates">
          {groups.map((g) => (
            <section key={g.label}>
              <h2 className="rt-group">{g.label}</h2>
              <ul>
                {g.rows.map((t) => (
                  <li key={t.id}>
                    <button type="button" className={`rt-item${t.id === selId && !adding ? " on" : ""}`}
                      aria-current={t.id === selId && !adding ? "true" : undefined}
                      onClick={() => { setSelId(t.id); setAdding(false); }}>
                      <span className="rt-item-name">{t.name}</span>
                      <span className="rt-item-meta">
                        {PAPER_LABEL[t.paper]}
                        {t.isDefault && <span className="pill ok">Default</span>}
                        {!t.isActive && <span className="pill">Off</span>}
                        {!t.publishedVersion && <span className="pill draft">Draft</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {templates.length === 0 && <p className="hint rt-empty">No templates yet. Sales print the standard receipt until one is published and made the default.</p>}
          <button type="button" className="btn ghost rt-new" onClick={() => setAdding(true)} aria-pressed={adding}>
            <Plus size={16} aria-hidden="true" /> New template
          </button>
        </aside>

        <div className="rt-main">
          {adding ? (
            <NewTemplate templates={templates} branches={branches} isAdmin={isAdmin} myBranchId={myBranchId}
              onCreated={(id) => { setSelId(id); setAdding(false); }} onCancel={templates.length ? () => setAdding(false) : undefined} />
          ) : sel ? (
            <TemplateEditor key={sel.id + (sel.publishedVersion ?? 0)} t={sel} branches={branches} company={company} sales={sales} />
          ) : null}
          {isAdmin && <CompanyDetails company={company} />}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- creating --

function NewTemplate({ templates, branches, isAdmin, myBranchId, onCreated, onCancel }: {
  templates: TemplateRow[]; branches: Branch[]; isAdmin: boolean; myBranchId: string | null;
  onCreated: (id: string) => void; onCancel?: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [res, setRes] = useState<Result>(null);
  const scopes = isAdmin ? [{ id: "", name: "Company-wide" }, ...branches] : branches.filter((b) => b.id === myBranchId);
  const [form, setForm] = useState({ name: "", paper: "80" as Paper, branchId: scopes[0]?.id ?? "", copyFrom: "" });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const r = await createReceiptTemplate({ ...form, branchId: form.branchId || null, copyFrom: form.copyFrom || null });
      setRes(r);
      if (r?.id) { router.refresh(); onCreated(r.id); }
    });
  };

  if (scopes.length === 0) {
    return <div className="card"><div className="card-body hint">Only an administrator can add a company-wide template.</div></div>;
  }
  return (
    <form className="card" onSubmit={submit}>
      <div className="card-head"><h2>New template</h2></div>
      <div className="card-body">
        <div className="row">
          <div className="field">
            <label htmlFor="rt-new-name">Name</label>
            <input id="rt-new-name" required maxLength={80} value={form.name} autoFocus
              onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Counter 58 mm" />
          </div>
          <div className="field">
            <label htmlFor="rt-new-scope">Used by</label>
            <select id="rt-new-scope" value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })}>
              {scopes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="rt-new-copy">Start from</label>
            <select id="rt-new-copy" value={form.copyFrom} onChange={(e) => setForm({ ...form, copyFrom: e.target.value })}>
              <option value="">Standard receipt</option>
              {templates.map((t) => <option key={t.id} value={t.id}>Copy of {t.name}</option>)}
            </select>
          </div>
        </div>
        <div className="field rt-paper-field">
          <span className="rt-label" id="rt-new-paper">Paper</span>
          <PaperPicker value={form.paper} onChange={(paper) => setForm({ ...form, paper })} labelledBy="rt-new-paper" />
        </div>
        {res?.error && <div className="alert" role="alert">{res.error}</div>}
      </div>
      <div className="rt-bar">
        {onCancel && <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>}
        <button type="submit" className="btn" disabled={pending}>{pending ? "Creating…" : "Create draft"}</button>
      </div>
    </form>
  );
}

function PaperPicker({ value, onChange, labelledBy, disabled }: {
  value: Paper; onChange: (p: Paper) => void; labelledBy: string; disabled?: boolean;
}) {
  return (
    <div className="rt-seg" role="radiogroup" aria-labelledby={labelledBy}>
      {PAPERS.map((p) => (
        <button key={p} type="button" role="radio" aria-checked={value === p} disabled={disabled}
          className={value === p ? "on" : ""} onClick={() => onChange(p)}>{PAPER_LABEL[p]}</button>
      ))}
    </div>
  );
}

// -------------------------------------------------------------- editing --

function TemplateEditor({ t, branches, company, sales }: {
  t: TemplateRow; branches: Branch[]; company: Company; sales: Sale[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("general");
  const [name, setName] = useState(t.name);
  const [paper, setPaper] = useState<Paper>(t.paper);
  const [cfg, setCfg] = useState<ReceiptConfig>(t.draft);
  const [res, setRes] = useState<Result>(null);
  const [pending, start] = useTransition();
  const [saleId, setSaleId] = useState("");
  const [sale, setSale] = useState<ReceiptData | null>(null);
  const ro = !t.canEdit;

  const changed = name !== t.name || paper !== t.paper || JSON.stringify(cfg) !== JSON.stringify(t.draft);

  // A change of paper keeps every choice but the width, which is the paper's.
  const changePaper = (p: Paper) => { setPaper(p); setCfg((c) => sanitizeConfig({ ...c, general: { ...c.general, printableWidthMm: p === "A4" ? 0 : WIDTH[p].def } }, p)); };
  const set = <K extends keyof ReceiptConfig>(k: K, patch: Partial<ReceiptConfig[K]>) =>
    setCfg((c) => ({ ...c, [k]: { ...c[k], ...patch } }));

  useEffect(() => {
    if (!saleId) { setSale(null); return; }
    let live = true;
    previewSaleData(saleId).then((d) => { if (live) setSale(d); });
    return () => { live = false; };
  }, [saleId]);

  const run = (fn: () => Promise<Result>) => start(async () => {
    const r = await fn();
    setRes(r);
    if (r?.ok) router.refresh();
  });
  const save = () => run(() => saveReceiptDraft({ id: t.id, name, paper, config: cfg }));
  // Publishing publishes what is on screen: unsaved edits are saved first.
  const publish = () => run(async () => {
    if (changed) {
      const s = await saveReceiptDraft({ id: t.id, name, paper, config: cfg });
      if (s?.error) return s;
    }
    return publishReceiptTemplate({ id: t.id });
  });

  const branch = branches.find((b) => b.id === t.branchId);
  const identity: ReceiptIdentity = {
    ...SAMPLE_IDENTITY,
    companyName: company.name,
    branchName: branch?.name ?? SAMPLE_IDENTITY.branchName,
    address: branch?.address ?? company.address ?? SAMPLE_IDENTITY.address,
    phone: branch?.phone ?? company.phone ?? SAMPLE_IDENTITY.phone,
    hasLogo: company.hasLogo,
  };
  const live = sanitizeConfig(cfg, paper);
  const slip = (
    <ReceiptSlip data={sale ?? SAMPLE_RECEIPT} config={live} identity={identity} paper={paper}
      logoUrl={company.hasLogo ? "/api/company-logo" : null} sample={!sale} />
  );

  const status = !t.publishedVersion ? "Draft — never published"
    : t.dirty || changed ? `Version ${t.publishedVersion} is live · unpublished changes`
    : `Version ${t.publishedVersion} is live`;

  return (
    <section className="card rt-editor" aria-labelledby="rt-title">
      <div className="rt-top">
        <div className="rt-title-row">
          <h2 id="rt-title">{t.name}</h2>
          <span className="rt-scope">{t.branchName ?? "Company-wide"}</span>
          {t.isDefault && <span className="pill ok">Default</span>}
          {!t.isActive && <span className="pill">Off</span>}
        </div>
        <p className="hint">{status}{t.publishedAt && ` · published ${when(t.publishedAt)}${t.publishedBy ? ` by ${t.publishedBy}` : ""}`}</p>
        {ro && <p className="hint">You can view this template. Only an administrator, or a manager of its branch, can change it.</p>}
        <div className="rt-tabs" role="tablist" aria-label="Template settings">
          {([["general", "General"], ["design", "Design & Content"], ["preview", "Preview & Test"]] as const).map(([k, l]) => (
            <button key={k} type="button" role="tab" id={`rt-tab-${k}`} aria-selected={tab === k}
              aria-controls="rt-panel" className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>
      </div>

      <div className="rt-body" role="tabpanel" id="rt-panel" aria-labelledby={`rt-tab-${tab}`}>
        {tab !== "preview" && <fieldset className="rt-form" disabled={ro}>
          {tab === "general" && (
            <>
              <Group title="Template">
                <div className="field">
                  <label htmlFor="rt-name">Name</label>
                  <input id="rt-name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="field">
                  <span className="rt-label" id="rt-paper">Paper</span>
                  <PaperPicker value={paper} onChange={changePaper} labelledBy="rt-paper" disabled={ro} />
                </div>
                {paper !== "A4" && (
                  <div className="field">
                    <label htmlFor="rt-width">Printable width (mm)</label>
                    <input id="rt-width" type="number" min={WIDTH[paper].min} max={WIDTH[paper].max} step={1}
                      value={cfg.general.printableWidthMm}
                      onChange={(e) => set("general", { printableWidthMm: Number(e.target.value) })} />
                    <span className="hint">
                      What your printer actually prints across — {paper} mm printers usually print about {WIDTH[paper].def} mm.
                      Allowed {WIDTH[paper].min}–{WIDTH[paper].max} mm.
                    </span>
                  </div>
                )}
              </Group>
              <Group title="After a sale">
                <Switch label="Show the receipt when a sale completes" v={cfg.general.showAfterSale} on={(v) => set("general", { showAfterSale: v })} />
                <Switch label="Open the print dialog automatically" v={cfg.general.autoPrint} on={(v) => set("general", { autoPrint: v })}
                  hint="Asks the browser to print as the receipt opens. The browser still shows its own print dialog." />
                <Switch label="Show a Print button" v={cfg.general.showPrintButton} on={(v) => set("general", { showPrintButton: v })} />
                <Switch label="Offer Save as PDF" v={cfg.general.allowPdf} on={(v) => set("general", { allowPdf: v })}
                  hint="Opens the print dialog, where “Save as PDF” is chosen as the printer." />
                <Switch label="Allow cashiers to reprint from Sales History" v={cfg.general.allowReprint} on={(v) => set("general", { allowReprint: v })}
                  hint="Managers can always reprint." />
              </Group>
              <Group title="Printing">
                <div className="field">
                  <label htmlFor="rt-lang">Language</label>
                  <select id="rt-lang" value="en" disabled><option value="en">English</option></select>
                </div>
                <p className="hint">
                  Receipts print through the browser’s print dialog. Choose the receipt printer there, set margins to
                  “None” and turn off headers and footers; most browsers remember it for next time.
                </p>
              </Group>
            </>
          )}

          {tab === "design" && (
            <>
              <Group title="Business identity">
                <p className="hint">
                  Name, address and phone come from the company{t.branchId ? " and the branch" : ""} — edit them in
                  {t.branchId ? " Warehouses (the branch) or" : ""} Company details below.
                </p>
                <Switch label="Logo" v={cfg.identity.showLogo} on={(v) => set("identity", { showLogo: v })}
                  hint={company.hasLogo ? undefined : "No logo uploaded yet."} />
                <Text label="Name printed on the receipt" v={cfg.identity.displayName} max={TEXT_LIMITS.displayName}
                  placeholder={company.name} on={(v) => set("identity", { displayName: v })} />
                <Switch label="Branch name" v={cfg.identity.showBranchName} on={(v) => set("identity", { showBranchName: v })} />
                <Switch label="Address" v={cfg.identity.showAddress} on={(v) => set("identity", { showAddress: v })} />
                <Switch label="Phone" v={cfg.identity.showPhone} on={(v) => set("identity", { showPhone: v })} />
                <Text label="Other contact (email, Viber, website)" v={cfg.identity.extraContact} max={TEXT_LIMITS.extraContact} area
                  on={(v) => set("identity", { extraContact: v })} />
              </Group>
              <Group title="Sale details" note="Receipt number, date, items and total always print.">
                <Switch label="Cashier" v={cfg.transaction.showCashier} on={(v) => set("transaction", { showCashier: v })} />
                <Switch label="Salesperson" v={cfg.transaction.showSalesman} on={(v) => set("transaction", { showSalesman: v })} />
                <Switch label="Customer" v={cfg.transaction.showCustomer} on={(v) => set("transaction", { showCustomer: v })} />
                <Switch label="Payment method" v={cfg.transaction.showPaymentMethod} on={(v) => set("transaction", { showPaymentMethod: v })} />
                <Switch label="Amount paid by each method" v={cfg.transaction.showPaymentBreakdown} on={(v) => set("transaction", { showPaymentBreakdown: v })} />
                <Switch label="Subtotal" v={cfg.transaction.showSubtotal} on={(v) => set("transaction", { showSubtotal: v })} />
                <Switch label="Discounts" v={cfg.transaction.showDiscounts} on={(v) => set("transaction", { showDiscounts: v })} />
                <Switch label="Tax line when no tax was charged" v={cfg.transaction.showTaxWhenZero} on={(v) => set("transaction", { showTaxWhenZero: v })}
                  hint="Tax actually charged always prints." />
              </Group>
              <Group title="Items">
                <Switch label="Variant (storage, colour)" v={cfg.product.showVariant} on={(v) => set("product", { showVariant: v })} />
                <Switch label="Quantity" v={cfg.product.showQuantity} on={(v) => set("product", { showQuantity: v })} />
                <Switch label="Unit price" v={cfg.product.showUnitPrice} on={(v) => set("product", { showUnitPrice: v })} />
                <Switch label="Line discount" v={cfg.product.showDiscount} on={(v) => set("product", { showDiscount: v })} />
                <Switch label="Line total" v={cfg.product.showLineTotal} on={(v) => set("product", { showLineTotal: v })} />
                <Switch label="IMEI / serial numbers" v={cfg.product.showImei} on={(v) => set("product", { showImei: v })} />
                {cfg.product.showImei && (
                  <div className="field">
                    <span className="rt-label" id="rt-imei">IMEI shown as</span>
                    <Seg labelledBy="rt-imei" value={cfg.product.imeiMode} on={(v) => set("product", { imeiMode: v })}
                      options={[["full", "Full number"], ["masked", "Masked (3569••••817)"]]} />
                  </div>
                )}
              </Group>
              <Group title="Warranty" note="From the warranty of each unit sold.">
                <Switch label="Warranty" v={cfg.warranty.show} on={(v) => set("warranty", { show: v })} />
                {cfg.warranty.show && (
                  <>
                    <Switch label="Warranty period" v={cfg.warranty.showPeriod} on={(v) => set("warranty", { showPeriod: v })} />
                    <Switch label="Start and end dates" v={cfg.warranty.showDates} on={(v) => set("warranty", { showDates: v })} />
                    <Text label="Warranty terms" v={cfg.warranty.policyText} max={TEXT_LIMITS.policyText} area
                      on={(v) => set("warranty", { policyText: v })} />
                  </>
                )}
              </Group>
              <Group title="Your text" note="Plain text. Line breaks are kept.">
                <Text label="Header message" v={cfg.custom.headerText} max={TEXT_LIMITS.headerText} area on={(v) => set("custom", { headerText: v })} />
                <Text label="Thank-you message" v={cfg.custom.thankYou} max={TEXT_LIMITS.thankYou} area on={(v) => set("custom", { thankYou: v })} />
                <Text label="Return and exchange policy" v={cfg.custom.returnPolicy} max={TEXT_LIMITS.returnPolicy} area on={(v) => set("custom", { returnPolicy: v })} />
                <Text label="Footer" v={cfg.custom.footerText} max={TEXT_LIMITS.footerText} area on={(v) => set("custom", { footerText: v })} />
              </Group>
              <Group title="Style">
                <div className="field"><span className="rt-label" id="rt-fs">Text size</span>
                  <Seg labelledBy="rt-fs" value={cfg.style.fontSize} on={(v) => set("style", { fontSize: v })}
                    options={[["small", "Small"], ["normal", "Normal"], ["large", "Large"]]} /></div>
                <div className="field"><span className="rt-label" id="rt-al">Header</span>
                  <Seg labelledBy="rt-al" value={cfg.style.headerAlign} on={(v) => set("style", { headerAlign: v })}
                    options={[["center", "Centered"], ["left", "Left"]]} /></div>
                <div className="field"><span className="rt-label" id="rt-ls">Dividers</span>
                  <Seg labelledBy="rt-ls" value={cfg.style.lineStyle} on={(v) => set("style", { lineStyle: v })}
                    options={[["dashed", "Dashed"], ["solid", "Solid"]]} /></div>
                <div className="field"><span className="rt-label" id="rt-dn">Spacing</span>
                  <Seg labelledBy="rt-dn" value={cfg.style.density} on={(v) => set("style", { density: v })}
                    options={[["normal", "Normal"], ["compact", "Compact"]]} /></div>
              </Group>
            </>
          )}
        </fieldset>}

        {tab === "preview" && (
          <div className="rt-form">
            <Group title="Preview with">
              <div className="field">
                <label htmlFor="rt-sale">Data</label>
                <select id="rt-sale" value={saleId} onChange={(e) => setSaleId(e.target.value)}>
                  <option value="">Sample sale (not real)</option>
                  {sales.map((s) => <option key={s.id} value={s.id}>{s.docNo} · {shortDate(s.date)} · {money(s.total)}</option>)}
                </select>
                <span className="hint">A real sale is only read, never changed or reprinted for the customer.</span>
              </div>
              <button type="button" className="btn ghost" onClick={() => window.print()}>
                <Printer size={16} aria-hidden="true" /> Test print
              </button>
              <p className="hint">Prints the preview as shown, unsaved changes included, on {PAPER_LABEL[paper]}.</p>
            </Group>
            <Group title="Published versions">
              {t.versions.length === 0 ? <p className="hint">Not published yet.</p> : (
                <ul className="rt-log">
                  {t.versions.map((v) => (
                    <li key={v.version}><b>Version {v.version}</b> · {PAPER_LABEL[v.paper]} · {when(v.publishedAt)}{v.publishedBy ? ` · ${v.publishedBy}` : ""}</li>
                  ))}
                </ul>
              )}
            </Group>
            <Group title="History">
              {t.audit.length === 0 ? <p className="hint">Nothing yet.</p> : (
                <ul className="rt-log">
                  {t.audit.map((a, i) => (
                    <li key={i}>{ACTION_LABEL[a.action] ?? a.action} · {when(a.at)}{a.by ? ` · ${a.by}` : ""}</li>
                  ))}
                </ul>
              )}
            </Group>
          </div>
        )}

        <div className="rt-preview-col">
          <div className="rt-preview-label">{sale ? `Preview · ${sale.docNo}` : "Preview · sample data"} · {PAPER_LABEL[paper]}</div>
          <div className={`rc-preview rc-preview-${paper}`} aria-label="Receipt preview">{slip}</div>
        </div>
      </div>

      {res?.error && <div className="alert rt-msg" role="alert">{res.error}</div>}
      {res?.ok && <div className="alert ok rt-msg" role="status">{res.ok}</div>}

      {!ro && (
        <div className="rt-bar">
          <label className="rt-active">
            <input type="checkbox" name="active" role="switch" checked={t.isActive} disabled={pending}
              onChange={(e) => run(() => setReceiptTemplateActive({ id: t.id, active: e.target.checked }))} />
            {t.isActive ? "On" : "Off"}
          </label>
          {!t.isDefault && (
            <button type="button" className="btn ghost" disabled={pending || !t.publishedVersion || !t.isActive}
              title={!t.publishedVersion ? "Publish first" : !t.isActive ? "Turn it on first" : undefined}
              onClick={() => run(() => setDefaultReceiptTemplate({ id: t.id }))}>
              Make default{t.branchName ? ` for ${t.branchName}` : ""}
            </button>
          )}
          <span className="rt-spacer" />
          <button type="button" className="btn ghost" disabled={pending || !changed} onClick={save}>Save draft</button>
          <button type="button" className="btn" disabled={pending || (!changed && !t.dirty)} onClick={publish}>
            {pending ? "Working…" : "Publish"}
          </button>
        </div>
      )}

      <ReceiptPrintHost paper={paper}>{slip}</ReceiptPrintHost>
    </section>
  );
}

function Group({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="rt-group-box">
      <h3>{title}</h3>
      {note && <p className="hint">{note}</p>}
      <div className="rt-rows">{children}</div>
    </div>
  );
}

function Switch({ label, v, on, hint }: { label: string; v: boolean; on: (v: boolean) => void; hint?: string }) {
  return (
    <label className="rt-switch">
      <span><span>{label}</span>{hint && <span className="hint">{hint}</span>}</span>
      <input type="checkbox" name="opt" role="switch" checked={v} onChange={(e) => on(e.target.checked)} />
    </label>
  );
}

function Text({ label, v, on, max, area, placeholder }: {
  label: string; v: string; on: (v: string) => void; max: number; area?: boolean; placeholder?: string;
}) {
  const id = `rt-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {area
        ? <textarea id={id} rows={2} maxLength={max} value={v} placeholder={placeholder} onChange={(e) => on(e.target.value)} />
        : <input id={id} maxLength={max} value={v} placeholder={placeholder} onChange={(e) => on(e.target.value)} />}
    </div>
  );
}

function Seg<T extends string>({ value, on, options, labelledBy }: {
  value: T; on: (v: T) => void; options: Array<[T, string]>; labelledBy: string;
}) {
  return (
    <div className="rt-seg" role="radiogroup" aria-labelledby={labelledBy}>
      {options.map(([k, l]) => (
        <button key={k} type="button" role="radio" aria-checked={value === k} className={value === k ? "on" : ""} onClick={() => on(k)}>{l}</button>
      ))}
    </div>
  );
}

// ------------------------------------------------------ company details --

function CompanyDetails({ company }: { company: Company }) {
  const router = useRouter();
  const [address, setAddress] = useState(company.address ?? "");
  const [phone, setPhone] = useState(company.phone ?? "");
  const [res, setRes] = useState<Result>(null);
  const [pending, start] = useTransition();
  const [logoState, upload, uploading] = useActionState(uploadCompanyLogo, null);
  useEffect(() => { if (logoState?.ok) router.refresh(); }, [logoState, router]);

  return (
    <section className="card rt-company" aria-labelledby="rt-company">
      <div className="card-head"><h2 id="rt-company">Company details</h2></div>
      <div className="card-body">
        <p className="hint">Printed on every template. A branch’s own address and phone, set in Warehouses, print instead on its sales.</p>
        <div className="row">
          <div className="field">
            <label htmlFor="rt-co-addr">Address</label>
            <textarea id="rt-co-addr" rows={2} maxLength={300} value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="rt-co-phone">Phone</label>
            <input id="rt-co-phone" type="tel" maxLength={60} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
        </div>
        <div className="rt-inline">
          <button type="button" className="btn ghost" disabled={pending} onClick={() => start(async () => {
            const r = await saveCompanyContact({ address, phone }); setRes(r); if (r?.ok) router.refresh();
          })}>Save details</button>
          {res?.error && <span className="alert" role="alert">{res.error}</span>}
          {res?.ok && <span className="hint" role="status">{res.ok}</span>}
        </div>

        <form action={upload} className="rt-logo">
          {company.hasLogo && <img src="/api/company-logo" alt="Company logo" className="rt-logo-img" />}
          <div className="field">
            <label htmlFor="rt-logo">Logo</label>
            <input id="rt-logo" name="logo" type="file" accept="image/png,image/jpeg" required />
            <span className="hint">PNG or JPEG, under 300 KB. Black on white prints best on thermal paper.</span>
          </div>
          <div className="rt-inline">
            <button type="submit" className="btn ghost" disabled={uploading}>{uploading ? "Uploading…" : "Upload logo"}</button>
            {company.hasLogo && (
              <button type="button" className="btn danger" disabled={pending}
                onClick={() => start(async () => { const r = await removeCompanyLogo(); setRes(r); if (r?.ok) router.refresh(); })}>
                Remove logo
              </button>
            )}
            {logoState?.error && <span className="alert" role="alert">{logoState.error}</span>}
            {logoState?.ok && <span className="hint" role="status">{logoState.ok}</span>}
          </div>
        </form>
      </div>
    </section>
  );
}
