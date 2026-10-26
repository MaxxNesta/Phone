"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowUpRight, Search, RotateCcw, Smartphone, FileText, Package } from "lucide-react";
import type { ActionResult } from "@/lib/actions";
import { optionLabel } from "@/lib/item-code";

export type EditorItem = {
  id: string; code: string; name: string; nameCustom: boolean; barcode: string;
  isActive: boolean; isStocked: boolean; identity: string; tracksSerial: boolean;
  uom: string; brand: string | null; category: string;
  parentId: string | null; parentName: string | null;
  parts: { a: string; o: string }[];
  photo: string | null;
  /** The other variants of the same product, this one included. Empty for a plain item. */
  siblings: { id: string; code: string; name: string; qty: number; parts: string[]; photo: string | null }[];
  levels: { id: string; name: string; price: string }[];
  stock: { onHand: number; reserved: number; available: number; avgCost: number | null };
  /** What a unit of the latest receipt cost, landed costs included. Null without cost access. */
  unitCost: number | null;
  seeCost: boolean;
  purchases: { id: string; no: string | null; date: string; supplier: string | null; qty: number; unitCost: number | null }[];
  serials: { id: string; imei: string; status: string; where: string | null }[];
  serialCount: number;
};

const n0 = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 });
const n1 = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 1 });
const TRACKING: Record<string, string> = { IMEI: "IMEI tracked", SERIAL: "Serial tracked", OPTIONAL: "Optional serial", NONE: "Counted by quantity" };

/**
 * The one editor an item has, variant or not: who it is, what it sells for,
 * what is on the shelf, and (for a variant) its siblings beside it.
 *
 * Quiet on purpose: type and spacing carry the hierarchy, one blue for the
 * action, and nothing coloured that is not a warning.
 */
export function ItemEditor({ item, action }: {
  item: EditorItem; action: (prev: unknown, fd: FormData) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(action as never, null);
  const isVariant = !!item.parentId;
  const defaultName = isVariant && item.parentName
    ? `${item.parentName} ${item.parts.map((p) => optionLabel(p.a, p.o)).join(" / ")}`.trim() : item.name;

  const start = () => ({
    name: item.name, nameCustom: item.nameCustom, code: item.code, barcode: item.barcode, active: item.isActive,
    prices: Object.fromEntries(item.levels.map((l) => [l.id, l.price])),
  });
  const [f, setF] = useState(start);
  const [saved, setSaved] = useState(false);
  useEffect(() => { setF(start()); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [item]);
  useEffect(() => { if (state && "ok" in state) { setSaved(true); router.refresh(); } }, [state, router]);

  const dirty = JSON.stringify(f) !== JSON.stringify(start());
  const valid = f.name.trim() !== "" && f.code.trim() !== "";
  const set = (patch: Partial<typeof f>) => { setSaved(false); setF((x) => ({ ...x, ...patch })); };

  // Margins are worked out live against the first price level, from what a unit cost.
  const first = Number(f.prices[item.levels[0]?.id] ?? "");
  const cost = item.unitCost;
  const gp = cost !== null && first > 0 ? first - cost : null;

  const [q, setQ] = useState("");
  const siblings = useMemo(() => item.siblings.filter((s) =>
    !q || `${s.code} ${s.name} ${s.parts.join(" ")}`.toLowerCase().includes(q.toLowerCase())), [item.siblings, q]);
  const stockHref = `/items/stock?q=${encodeURIComponent(item.code)}`;

  return (
    <form action={formAction} className="ie-form">
      <input type="hidden" name="id" value={item.id} />
      <input type="hidden" name="name" value={f.name} />
      <input type="hidden" name="name_custom" value={f.nameCustom ? "1" : "0"} />
      <input type="hidden" name="code" value={f.code} />
      <input type="hidden" name="barcode" value={f.barcode} />
      <input type="hidden" name="is_active" value={f.active ? "1" : "0"} />
      <input type="hidden" name="prices" value={JSON.stringify(f.prices)} />

      <header className="ie-title">
        <h1>{isVariant ? "Edit variant" : "Edit item"}</h1>
        <p>
          {isVariant && item.parentName ? <><Link href={`/items/${item.parentId}`}>{item.parentName}</Link> · </> : null}
          {item.code}
          {isVariant && (
            <> · <Link href={`/items/${item.parentId}/variants`}>Show all {item.siblings.length} variants</Link></>
          )}
        </p>
      </header>

      {state && "error" in state && <div className="alert" role="alert">{state.error}</div>}

      <div className={`ie-cols${isVariant ? "" : " single"}`}>
        <div className="ie-main">
          <section className="ie-card ie-hero">
            <span className="ie-photo">
              {item.photo
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={item.photo} alt="" />
                : <Package size={26} strokeWidth={1.5} aria-hidden="true" />}
            </span>
            <div>
              <h2>{f.name || "Untitled"}</h2>
              <div className="ie-chips">
                {item.parts.length > 0
                  ? item.parts.map((p) => <span key={p.a} className="ie-chip" title={p.a}>{p.o}</span>)
                  : <span className="ie-chip">{item.category}</span>}
              </div>
            </div>
            <span className={`ie-state${f.active ? "" : " off"}`}>{f.active ? "Active" : "Inactive"}</span>
          </section>

          <section className="ie-card">
            <h3>{isVariant ? "Variant identity" : "Item identity"}</h3>
            <div className="ie-grid3">
              <label className="ie-field wide2">
                <span>{isVariant ? "Full preview name" : "Name"}</span>
                <span className="ie-name">
                  <input value={f.name} maxLength={200}
                    onChange={(e) => set({ name: e.target.value, nameCustom: isVariant && e.target.value.trim() !== defaultName })} />
                  {isVariant && f.nameCustom && (
                    <button type="button" className="ie-reset" title="Reset to the generated name" aria-label="Reset name"
                      onClick={() => set({ name: defaultName, nameCustom: false })}><RotateCcw size={13} aria-hidden="true" /></button>
                  )}
                </span>
              </label>
              <label className="ie-field">
                <span>{isVariant ? "Variant SKU" : "SKU"}</span>
                <input value={f.code} className="mono" style={{ textTransform: "uppercase" }}
                  onChange={(e) => set({ code: e.target.value })} />
              </label>
              <label className="ie-field">
                <span>Barcode</span>
                <input value={f.barcode} inputMode="numeric" className="mono" placeholder="Scan or type"
                  onChange={(e) => set({ barcode: e.target.value })} />
              </label>
            </div>

            <div className="ie-grid4">
              {isVariant
                ? item.parts.map((p) => (
                    <div key={p.a} className="ie-field"><span>{p.a.charAt(0).toUpperCase() + p.a.slice(1)}</span><output className="ie-ro">{p.o}</output></div>))
                : <>
                    <div className="ie-field"><span>Category</span><output className="ie-ro">{item.category}</output></div>
                    <div className="ie-field"><span>Unit</span><output className="ie-ro">{item.uom}</output></div>
                    {item.brand && <div className="ie-field"><span>Brand</span><output className="ie-ro">{item.brand}</output></div>}
                  </>}
              {item.isStocked && (
                <div className="ie-field"><span>Tracking</span><output className="ie-ro">{TRACKING[item.identity] ?? item.identity}</output></div>
              )}
              <label className="ie-field">
                <span>Status</span>
                <select value={f.active ? "1" : "0"} onChange={(e) => set({ active: e.target.value === "1" })}>
                  <option value="1">Active</option><option value="0">Inactive</option>
                </select>
              </label>
            </div>
            {!isVariant && (
              <p className="ie-note">
                Category, unit, packs and brand are set when the item is made.{" "}
                <Link href={`/items?edit=${item.id}`}>More settings <ArrowUpRight size={12} aria-hidden="true" /></Link>
              </p>
            )}
          </section>

          <section className="ie-card">
            <h3>Pricing</h3>
            <div className="ie-prices">
              {item.levels.map((l) => (
                <label key={l.id} className="ie-field">
                  <span>{l.name}</span>
                  <span className="ie-money">
                    <i>MMK</i>
                    <input type="number" min="0" step="any" inputMode="decimal" placeholder="No price" value={f.prices[l.id] ?? ""}
                      onChange={(e) => set({ prices: { ...f.prices, [l.id]: e.target.value } })} />
                  </span>
                </label>
              ))}
              {item.seeCost && (
                <div className="ie-field">
                  <span>Last unit cost</span>
                  <output className="ie-ro mono">{cost === null ? "—" : `MMK ${n0(cost)}`}</output>
                </div>
              )}
            </div>
            {item.seeCost && (
              <dl className="ie-metrics">
                <div><dt>Est. gross profit <small>vs {item.levels[0]?.name ?? "price 1"}</small></dt><dd>{gp === null ? "—" : `MMK ${n0(gp)}`}</dd></div>
                <div><dt>Margin</dt><dd>{gp === null ? "—" : `${n1((gp / first) * 100)}%`}</dd></div>
                <div><dt>Markup</dt><dd>{gp === null || !cost ? "—" : `${n1((gp / cost) * 100)}%`}</dd></div>
              </dl>
            )}
          </section>

          {item.isStocked && (
            <section className="ie-card">
              <div className="ie-head">
                <h3>{item.tracksSerial ? "Stock & IMEI summary" : "Stock summary"}</h3>
                <Link className="ie-link" href={stockHref}>View in Stock Position <ArrowUpRight size={13} aria-hidden="true" /></Link>
              </div>
              <dl className="ie-stats">
                <div><dt>On hand</dt><dd>{n0(item.stock.onHand)}</dd></div>
                <div><dt>Reserved</dt><dd>{n0(item.stock.reserved)}</dd></div>
                <div><dt>Available</dt><dd>{n0(item.stock.available)}</dd></div>
                {item.seeCost && <div><dt>Avg. cost</dt><dd>{item.stock.avgCost === null ? "—" : `MMK ${n0(item.stock.avgCost)}`}</dd></div>}
              </dl>
              {item.tracksSerial && (
                <div className="ie-units">
                  <div className="ie-head sub">
                    <strong>IMEI list ({item.serialCount})</strong>
                    {item.serialCount > 0 && <Link className="ie-link" href={`/inventory/phones?q=${encodeURIComponent(item.code)}`}>Open in IMEI Inventory <ArrowUpRight size={13} aria-hidden="true" /></Link>}
                  </div>
                  {item.serials.length === 0
                    ? <p className="ie-empty"><Smartphone size={16} aria-hidden="true" /> No IMEI records for this variant yet. They appear when stock is received.</p>
                    : <ul>{item.serials.map((s) => (
                        <li key={s.id}><Link href={`/inventory/phones/${s.id}`} className="mono">{s.imei}</Link>
                          <span>{s.where ?? "—"}</span><span>{s.status === "IN_STOCK" ? "On shelf" : s.status.replace(/_/g, " ").toLowerCase()}</span></li>))}
                      </ul>}
                </div>
              )}
            </section>
          )}
        </div>

        <aside className="ie-side">
          {isVariant && (
            <section className="ie-card">
              <h3>Variant list <span>({item.siblings.length})</span></h3>
              <label className="ie-search">
                <Search size={14} aria-hidden="true" />
                <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search variants…" aria-label="Search variants" />
              </label>
              <ul className="ie-variants">
                {siblings.map((s) => (
                  <li key={s.id}>
                    <Link href={`/items/${s.id}/edit`} aria-current={s.id === item.id ? "page" : undefined}>
                      <span className="ie-vthumb">{s.photo
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={s.photo} alt="" /> : <Package size={16} strokeWidth={1.5} aria-hidden="true" />}</span>
                      <span className="ie-vtext"><strong>{s.name}</strong><small>{s.parts.join(" · ")} · {s.code}</small></span>
                      <span className="ie-vqty"><small>Stock</small>{n0(s.qty)}</span>
                    </Link>
                  </li>
                ))}
                {siblings.length === 0 && <li className="ie-empty">No variant matches.</li>}
              </ul>
            </section>
          )}

          <section className="ie-card">
            <h3>Purchase history</h3>
            {item.purchases.length === 0 ? (
              <p className="ie-empty block"><FileText size={18} aria-hidden="true" />
                <strong>No purchase history yet</strong>Purchases appear here once stock is received.</p>
            ) : (
              <table className="ie-table">
                <thead><tr><th>Date</th><th>GR</th><th>Supplier</th><th className="r">Qty</th>{item.seeCost && <th className="r">Unit cost</th>}</tr></thead>
                <tbody>{item.purchases.map((p) => (
                  <tr key={p.id}><td>{p.date}</td><td><Link href={`/documents/${p.id}`}>{p.no ?? "—"}</Link></td>
                    <td>{p.supplier ?? "—"}</td><td className="r">{n0(p.qty)}</td>
                    {item.seeCost && <td className="r">{p.unitCost === null ? "—" : n0(p.unitCost)}</td>}</tr>))}</tbody>
              </table>
            )}
          </section>
        </aside>
      </div>

      <footer className="ie-bar">
        <Link className="ie-btn" href={isVariant ? `/items/${item.parentId}/variants` : "/items"}>
          <ArrowLeft size={15} aria-hidden="true" /> Back to products
        </Link>
        <span className="ie-bar-note" aria-live="polite">
          {saved && !dirty ? "Saved" : dirty ? "Unsaved changes" : ""}
        </span>
        <button type="button" className="ie-btn" disabled={!dirty} onClick={() => { setF(start()); setSaved(false); }}>Cancel</button>
        <button type="submit" className="ie-btn primary" disabled={pending || !dirty || !valid}>
          {pending ? "Saving…" : isVariant ? "Save variant" : "Save item"}
        </button>
      </footer>
    </form>
  );
}
