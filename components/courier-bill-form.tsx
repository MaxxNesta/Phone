"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Eye, FileText, Hash, Layers, Package, Smartphone, StickyNote, Wallet, X } from "lucide-react";
import type { PreviewShare } from "@/lib/courier-payables";

type Opt = { id: string; label: string };
type Receipt = { id: string; no: string; date: string; supplier: string | null; warehouse: string | null; phones: number; landed: number };

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

export function CourierBillForm({ action, preview, couriers, receipts, types, carriageAccount, payableAccount, clearingAccount, initialPartnerId, initialReceiptId, today, paidFrom = [] }: {
  action: (prev: { error?: string } | null, fd: FormData) => Promise<{ error?: string } | null>;
  /** Works out every phone's share without posting anything. */
  preview: (fd: FormData) => Promise<{ error?: string; shares?: PreviewShare[] }>;
  couriers: Opt[]; receipts: Receipt[]; types: (Opt & { code: string; method: string })[];
  carriageAccount: string | null; payableAccount: string | null;
  /** Where any cost but carriage waits when paid now: Landed Cost Clearing. */
  clearingAccount?: string | null;
  initialPartnerId?: string; initialReceiptId?: string; today: string;
  /** Cash and bank accounts, for a bill paid when it is recorded. */
  paidFrom?: Opt[];
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const formRef = useRef<HTMLFormElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [previewing, startPreview] = useTransition();
  const [shown, setShown] = useState<{ shares: PreviewShare[]; date: string; reference: string; note: string } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const openPreview = () => {
    const form = formRef.current;
    if (!form || !form.reportValidity()) return;
    const fd = new FormData(form);
    setPreviewError(null);
    startPreview(async () => {
      const r = await preview(fd);
      if (r.error) { setPreviewError(r.error); return; }
      setShown({ shares: r.shares ?? [], date: String(fd.get("doc_date") ?? ""),
                 reference: String(fd.get("reference") ?? ""), note: String(fd.get("memo") ?? "") });
      dialogRef.current?.showModal();
    });
  };
  const [chosen, setChosen] = useState<string[]>(initialReceiptId ? [initialReceiptId] : []);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("EQUAL");
  // "" = owed to the courier, paid later; otherwise the account it is paid from now.
  const [payment, setPayment] = useState("");
  const paidNow = payment !== "";
  const paidLabel = paidFrom.find((a) => a.id === payment)?.label;
  const phones = receipts.filter((r) => chosen.includes(r.id)).reduce((s, r) => s + r.phones, 0);
  const value = Number(amount) || 0;
  const total = method === "PER" ? value * phones : value;
  const each = phones > 0 && value > 0 ? (method === "PER" ? value : value / phones) : 0;
  const defaultType = types.find((t) => t.code === "CARRIAGE") ?? types[0];
  const [typeId, setTypeId] = useState(defaultType?.id ?? "");
  const type = types.find((t) => t.id === typeId) ?? defaultType;
  const carriage = type?.code === "CARRIAGE";
  // What the debit side is called: carriage reads as the shop's books do,
  // anything else waits in clearing when paid now, or goes straight on when owed.
  const via = carriage ? (carriageAccount ?? "Carriage Inward") : (clearingAccount ?? "Landed Cost Clearing");
  const credit = paidNow ? `${paidLabel} · paid now` : `${payableAccount ?? "Payable (Other)"} · owed`;

  return (
    <form ref={formRef} action={formAction} className="form wide docsheet">
      {(previewError || state?.error) && <div className="alert">{previewError ?? state?.error}</div>}
      <input type="hidden" name="cost_type_id" value={typeId} />
      <div className="card doc-info">
        {/* With more than carriage in use, the first question is what the cost is. */}
        {types.length > 1 && (
          <div className="receive-row cost-type-row">
            <span className="receive-q" id="cost-type-q">What is this cost?</span>
            <div className="segmented" role="radiogroup" aria-labelledby="cost-type-q">
              {types.map((t) => (
                <button key={t.id} type="button" role="radio" aria-checked={typeId === t.id}
                  className={`seg${typeId === t.id ? " on" : ""}`} onClick={() => setTypeId(t.id)}>{t.label}</button>
              ))}
            </div>
          </div>
        )}
        <div className="card-body">
          <div className="doc-fields">
            <div className="field">
              <label htmlFor="doc_date"><CalendarDays size={13} aria-hidden="true" />Bill date</label>
              <input id="doc_date" name="doc_date" type="date" defaultValue={today} max={today} required />
            </div>
            <div className="field">
              <label htmlFor="amount"><Hash size={13} aria-hidden="true" />{method === "PER" ? "Per phone" : "Amount"}</label>
              <input id="amount" type="number" min="0" step="any" inputMode="decimal" value={amount}
                onChange={(e) => setAmount(e.target.value)} placeholder={method === "PER" ? "e.g. 45000" : "e.g. 900000"} required />
              <input type="hidden" name="amount" value={total > 0 ? String(total) : ""} />
            </div>
            <div className="field">
              <label htmlFor="payment"><Wallet size={13} aria-hidden="true" />Payment</label>
              <select id="payment" value={payment} onChange={(e) => setPayment(e.target.value)}>
                <option value="">{carriage ? "Pay later · owed to courier" : "Pay later · owed"}</option>
                {paidFrom.map((a) => <option key={a.id} value={a.id}>Paid now · {a.label}</option>)}
              </select>
              <input type="hidden" name="paid_from" value={payment} />
            </div>
            <div className="field">
              <label htmlFor="method"><Layers size={13} aria-hidden="true" />Spread</label>
              <select id="method" value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="EQUAL">Total, shared equally</option>
                <option value="PER">Fixed per phone</option>
                <option value="VALUE">Total, by purchase value</option>
              </select>
              <input type="hidden" name="method" value={method === "VALUE" ? "VALUE" : "EQUAL"} />
            </div>
          </div>
          <div className="doc-info-foot">
            <details className="moredetails">
              <summary>Additional details <span className="page-sub">(reference, note)</span></summary>
              <div className="row">
                <div className="field">
                  <label htmlFor="reference"><Hash size={13} aria-hidden="true" />Reference</label>
                  <input id="reference" name="reference" type="text" placeholder="Courier's slip or waybill no." />
                </div>
                <div className="field span-2">
                  <label htmlFor="memo"><StickyNote size={13} aria-hidden="true" />Note</label>
                  <input id="memo" name="memo" type="text" placeholder="e.g. Car charges for iPhone (China) 20 qty × 45,000" />
                </div>
              </div>
            </details>
          </div>
        </div>
      </div>

      <section className="card">
        <div className="card-head"><h2><Package size={15} aria-hidden="true" style={{ verticalAlign: "-2px" }} /> {carriage ? "Which goods did they carry?" : `Which goods is this ${type?.label.toLowerCase() ?? "cost"} for?`}</h2>
          <span className="page-sub">{chosen.length ? `${phones} phone${phones === 1 ? "" : "s"} chosen` : "Choose one or more posted goods receipts"}</span></div>
        <div className="tablewrap" style={{ maxHeight: 340, overflow: "auto" }}>
          <table>
            <thead><tr><th className="tight" /><th>Goods receipt</th><th>Date</th><th>Supplier</th><th>Warehouse</th><th className="r">Phones</th><th>Landed costs</th></tr></thead>
            <tbody>
              {receipts.map((r) => (
                <tr key={r.id}>
                  <td className="tight"><input type="checkbox" name="receipt_id" value={r.id} checked={chosen.includes(r.id)} aria-label={`Spread onto ${r.no}`}
                    onChange={(e) => setChosen((c) => e.target.checked ? [...c, r.id] : c.filter((x) => x !== r.id))} /></td>
                  <td className="code"><Link href={`/documents/${r.id}`} target="_blank" style={{ color: "var(--link)" }}>{r.no}</Link></td>
                  <td>{r.date}</td>
                  <td>{r.supplier ?? "—"}</td>
                  <td>{r.warehouse ?? "—"}</td>
                  <td className="r">{r.phones}</td>
                  <td>{r.landed > 0 ? `${r.landed} already` : "—"}</td>
                </tr>
              ))}
              {receipts.length === 0 && <tr><td colSpan={7} className="empty">No posted goods receipts with phones yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {/* What posting writes, said before it is written. */}
      {total > 0 && (
        <section className="card">
          <div className="card-head"><h2>What this posts</h2>
            {method !== "VALUE" && each > 0 && <span className="page-sub">{fmt(each)} on each phone{method === "PER" ? ` · ${phones} phones = ${fmt(total)}` : ""}</span>}</div>
          <div className="tablewrap">
            <table>
              <thead><tr><th>Entry</th><th>Account</th><th className="r">Debit</th><th className="r">Credit</th></tr></thead>
              <tbody>
                {carriage || paidNow ? (
                  <>
                    <tr><td>{type?.label ?? "Charge"}</td><td>{via}</td><td className="r">{fmt(total)}</td><td /></tr>
                    <tr><td /><td>{credit}</td><td /><td className="r">{fmt(total)}</td></tr>
                    <tr><td>Spread onto phones</td><td>Inventory · {phones || "the chosen"} phone{phones === 1 ? "" : "s"}</td><td className="r">{fmt(total)}</td><td /></tr>
                    <tr><td /><td>{via}</td><td /><td className="r">{fmt(total)}</td></tr>
                  </>
                ) : (
                  <>
                    <tr><td>{type?.label ?? "Charge"}, onto phones</td><td>Inventory · {phones || "the chosen"} phone{phones === 1 ? "" : "s"}</td><td className="r">{fmt(total)}</td><td /></tr>
                    <tr><td /><td>{credit}</td><td /><td className="r">{fmt(total)}</td></tr>
                  </>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="actions form-commit">
        {/* Nothing posts from here: Preview shows every phone's share first,
            and Record and spread lives in that sheet. */}
        <button type="button" onClick={openPreview} disabled={previewing || pending || chosen.length === 0 || !(total > 0)}>
          <Eye size={15} aria-hidden="true" /> {previewing ? "Working it out…" : "Preview"}
        </button>
        <span className="page-sub">Cost of sales takes each phone&rsquo;s share when that phone is sold.</span>
      </div>

      <dialog ref={dialogRef} className="cbp" aria-labelledby="cbp-title" onClose={() => setShown(null)}>
        {shown && (
          <CarriagePreview
            shares={shown.shares} title={carriage ? "Preview carriage inward" : `Preview ${type?.label.toLowerCase() ?? "cost"}`}
            costLabel={carriage ? "Carriage" : (type?.label ?? "Cost")}
            details={[
              { icon: CalendarDays, label: "Bill date", value: shown.date ? new Date(shown.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—" },
              { icon: Hash, label: "Amount", value: `${fmt(total)} MMK` },
              { icon: Wallet, label: "Payment", value: paidNow ? `Paid now · ${paidLabel}` : "Pay later" },
              { icon: Layers, label: "Spread", value: method === "PER" ? "Fixed per phone" : method === "VALUE" ? "By purchase value" : "Equal per phone" },
              { icon: FileText, label: "Reference", value: shown.reference || "—" },
            ]}
            note={shown.note}
            posting={pending}
            onBack={() => dialogRef.current?.close()}
            onRecord={() => { dialogRef.current?.close(); formRef.current?.requestSubmit(); }}
          />
        )}
      </dialog>
    </form>
  );
}

/**
 * The sheet Preview opens: the bill as entered, read-only, and below it every
 * phone it lands on, grouped by goods receipt. Built from the same
 * calculation the posting runs, so what it shows is what Record and spread
 * writes — not an estimate of it.
 */
function CarriagePreview({ shares, title, costLabel, details, note, posting, onBack, onRecord }: {
  shares: PreviewShare[]; title: string; costLabel: string;
  details: { icon: typeof Hash; label: string; value: string }[]; note: string;
  posting: boolean; onBack: () => void; onRecord: () => void;
}) {
  const groups = [...shares.reduce((m, s) => m.set(s.receiptNo, [...(m.get(s.receiptNo) ?? []), s]), new Map<string, PreviewShare[]>())];
  const [open, setOpen] = useState<Set<string>>(() => new Set(groups.slice(0, 1).map(([no]) => no)));
  const allOpen = open.size === groups.length;
  const total = shares.reduce((s, x) => s + x.amount, 0);
  /** "+10,000" when every phone gets the same, otherwise the range. */
  const each = (list: PreviewShare[]) => {
    const lo = Math.min(...list.map((x) => x.amount)), hi = Math.max(...list.map((x) => x.amount));
    return lo === hi ? `+${fmt(lo)}` : `+${fmt(lo)} – ${fmt(hi)}`;
  };

  return (
    <div className="cbp-body">
      <header className="cbp-head">
        <div>
          <h2 id="cbp-title">{title}</h2>
          <p className="page-sub">Check where the cost lands before it is posted. Nothing has been recorded yet.</p>
        </div>
        <span className="cbp-badge"><Eye size={14} aria-hidden="true" /> Preview only · not posted</span>
        <button type="button" className="cbp-x" onClick={onBack} aria-label="Close preview"><X size={18} aria-hidden="true" /></button>
      </header>

      <div className="cbp-scroll">
        <section className="cbp-card">
          <h3>Voucher details</h3>
          <dl className="cbp-details">
            {details.map(({ icon: Icon, label, value }) => (
              <div key={label}><dt><Icon size={13} aria-hidden="true" />{label}</dt><dd title={value}>{value}</dd></div>
            ))}
            <div className="cbp-note"><dt><StickyNote size={13} aria-hidden="true" />Note</dt><dd title={note || undefined}>{note || "—"}</dd></div>
          </dl>
        </section>

        <section className="cbp-card cbp-summary" aria-label="Allocation summary">
          {[
            { icon: FileText, value: String(groups.length), label: groups.length === 1 ? "Goods receipt" : "Goods receipts" },
            { icon: Smartphone, value: String(shares.length), label: "Phones" },
            { icon: Layers, value: shares.length ? `${each(shares)} MMK` : "—", label: `${costLabel} per phone` },
            { icon: Hash, value: `${fmt(total)} MMK`, label: "Total spread" },
          ].map(({ icon: Icon, value, label }) => (
            <div key={label} className="cbp-stat">
              <span className="cbp-tile"><Icon size={18} aria-hidden="true" /></span>
              <span><strong>{value}</strong><span className="page-sub">{label}</span></span>
            </div>
          ))}
        </section>

        <section className="cbp-card">
          <div className="cbp-groups-head">
            <div><h3>By goods receipt</h3><p className="page-sub">Each phone&rsquo;s cost now, its share, and its cost after posting.</p></div>
            {groups.length > 1 && (
              <button type="button" className="ghost tiny" onClick={() => setOpen(allOpen ? new Set() : new Set(groups.map(([no]) => no)))}>
                <ChevronDown size={14} aria-hidden="true" style={{ transform: allOpen ? "rotate(180deg)" : undefined }} />
                {allOpen ? "Collapse all" : "Expand all"}
              </button>
            )}
          </div>
          {groups.map(([no, list]) => {
            const isOpen = open.has(no);
            const sum = list.reduce((s, x) => s + x.amount, 0);
            return (
              <div key={no} className="cbp-group" data-open={isOpen || undefined}>
                <button type="button" className="cbp-group-row" aria-expanded={isOpen}
                  onClick={() => setOpen((o) => { const n = new Set(o); if (n.has(no)) n.delete(no); else n.add(no); return n; })}>
                  {isOpen ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
                  <strong>{no}</strong>
                  <span className="page-sub">{list.length} phone{list.length === 1 ? "" : "s"}</span>
                  <span className="cbp-pill">{each(list)} per phone</span>
                  <strong className="cbp-sum">{fmt(sum)} MMK</strong>
                </button>
                {isOpen && (
                  <div className="tablewrap">
                    <table>
                      <thead><tr><th className="tight">#</th><th>IMEI / serial</th><th>Phone</th><th className="r">Cost now</th><th className="r">{costLabel}</th><th className="r">Cost after</th></tr></thead>
                      <tbody>
                        {list.map((x, i) => (
                          <tr key={x.serial}>
                            <td className="tight">{i + 1}</td>
                            <td className="code">{x.serial}</td>
                            <td className="cbp-item" title={x.item}>{x.item}</td>
                            <td className="r">{fmt(x.before)}</td>
                            <td className="r cbp-add">+{fmt(x.amount)}</td>
                            <td className="r"><strong>{fmt(x.before + x.amount)}</strong></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </section>
      </div>

      <footer className="cbp-foot">
        <button type="button" className="ghost" onClick={onBack}><ChevronLeft size={16} aria-hidden="true" /> Back to edit</button>
        <span className="cbp-total"><span className="page-sub">Total {costLabel.toLowerCase()} spread</span><strong>{fmt(total)} MMK</strong></span>
        <button type="button" onClick={onRecord} disabled={posting}>
          <FileText size={16} aria-hidden="true" /> {posting ? "Posting…" : "Record and spread"}
        </button>
      </footer>
    </div>
  );
}
