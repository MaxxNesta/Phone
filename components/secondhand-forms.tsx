"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import type { ActionResult } from "@/lib/actions";
import { lookupImei } from "@/lib/secondhand-actions";
import { useNotice } from "@/components/toast";

type Item = { id: string; code: string; name: string };
type Opt = { id: string; code?: string; name: string };
type Lookup = Awaited<ReturnType<typeof lookupImei>>;
const money = (v: number) => Math.round(v || 0).toLocaleString("en-US");
const GRADES = ["A", "B", "C", "D"];
const CHECKS = ["Power on & functions", "Screen", "Body & frame", "Cameras", "Buttons & ports", "Face ID / Touch ID"];

/** What our records say about an IMEI, as it is typed. */
function useImei(imei: string) {
  const [info, setInfo] = useState<Lookup | null>(null);
  useEffect(() => {
    const v = imei.trim();
    if (v.length < 6) { setInfo(null); return; }
    const t = setTimeout(() => { lookupImei(v).then(setInfo).catch(() => setInfo(null)); }, 350);
    return () => clearTimeout(t);
  }, [imei]);
  return info;
}

function Seller({ label }: { label: string }) {
  const [kind, setKind] = useState("CUSTOMER");
  return (
    <div className="card">
      <div className="card-head"><h2>{label}</h2></div>
      <div className="card-body"><div className="row">
        <div className="field"><label htmlFor="seller_name">Name</label><input id="seller_name" name="seller_name" required /></div>
        <div className="field"><label htmlFor="seller_phone">Phone</label><input id="seller_phone" name="seller_phone" inputMode="tel" required /></div>
        <div className="field"><label htmlFor="seller_kind">Source</label>
          <select id="seller_kind" name="seller_kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="CUSTOMER">Customer (individual)</option><option value="SHOP">Another shop</option>
          </select></div>
        <div className="field"><label htmlFor="seller_nrc">NRC</label>
          <input id="seller_nrc" name="seller_nrc" required={kind === "CUSTOMER"} placeholder="12/ABC(N)123456" />
          <span className="hint">Kept with the phone, in case it is ever reported stolen</span></div>
      </div></div>
    </div>
  );
}

function Inspection({ checks, setChecks }: { checks: Record<string, string>; setChecks: (c: Record<string, string>) => void }) {
  return (
    <div className="card">
      <div className="card-head"><h2>Inspection</h2></div>
      <div className="card-body">
        <div className="row">
          <div className="field"><label htmlFor="grade">Condition (grade)</label>
            <select id="grade" name="grade" defaultValue="B">{GRADES.map((g) => <option key={g} value={g}>Grade {g}</option>)}</select></div>
          <div className="field"><label htmlFor="battery_pct">Battery health %</label>
            <input id="battery_pct" name="battery_pct" type="number" min="0" max="100" /></div>
          <div className="field"><label htmlFor="activation_lock">Activation lock</label>
            <select id="activation_lock" name="activation_lock" defaultValue="REMOVED">
              <option value="REMOVED">Removed</option><option value="PRESENT">Still on</option></select></div>
        </div>
        <div className="sh-checks">
          {CHECKS.map((c) => (
            <label key={c} className="sh-check">
              <span>{c}</span>
              <select aria-label={c} value={checks[c] ?? "OK"} onChange={(e) => setChecks({ ...checks, [c]: e.target.value })}>
                <option>OK</option><option>Minor wear</option><option>Fault</option></select>
            </label>
          ))}
        </div>
        <input type="hidden" name="checks" value={JSON.stringify(checks)} />
        <div className="field" style={{ marginTop: 12 }}><label htmlFor="notes">Notes</label>
          <textarea id="notes" name="notes" rows={2} maxLength={500} /></div>
      </div>
    </div>
  );
}

/** Where an IMEI has been, as the counter needs to see it before buying it. */
function History({ info }: { info: Lookup | null }) {
  if (!info) return null;
  if (info.onShelf) return <div className="alert">This IMEI is in stock now. A phone cannot be bought in while it is on the shelf.</div>;
  if (info.previousSale) return (
    <div className="hintbar">Sold by us before: <Link href={`/documents/${info.previousSale.id}`}>{info.previousSale.docNo}</Link>
      {" "}on {info.previousSale.date}{info.previousSale.branch ? ` · ${info.previousSale.branch}` : ""}. It comes back as a new purchase;
      if the customer is returning that sale, record a customer return instead.</div>);
  return null;
}

function Summary({ rows, total, totalLabel }: { rows: [string, string][]; total: string; totalLabel: string }) {
  return (
    <aside className="sh-summary card">
      <div className="card-head"><h2>Summary</h2></div>
      <div className="card-body">
        <dl className="summary">
          {rows.map(([k, v]) => <div key={k} style={{ display: "contents" }}><dt>{k}</dt><dd>{v}</dd></div>)}
          <dt><strong>{totalLabel}</strong></dt><dd><strong>{total}</strong></dd>
        </dl>
      </div>
    </aside>
  );
}

export function BuySecondhandForm({ action, items, locations, cashAccounts, today }: {
  action: (p: unknown, fd: FormData) => Promise<ActionResult>;
  items: Item[]; locations: Opt[]; cashAccounts: Opt[]; today: string;
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(action as never, null);
  useNotice(state);
  const [key] = useState(() => crypto.randomUUID());
  const [imei, setImei] = useState("");
  const [price, setPrice] = useState("");
  const [payment, setPayment] = useState("NOW");
  const [checks, setChecks] = useState<Record<string, string>>({});
  const info = useImei(imei);

  return (
    <div className="sh-layout">
      <form action={formAction} className="form wide docsheet">
        <input type="hidden" name="idempotency_key" value={key} />
        {state && "error" in state && <div className="alert">{state.error}</div>}
        <Seller label="Seller" />
        <div className="card">
          <div className="card-head"><h2>Phone</h2></div>
          <div className="card-body"><div className="row">
            <div className="field" style={{ flex: 2 }}><label htmlFor="item_id">Model</label>
              <select id="item_id" name="item_id" required defaultValue={info?.unit?.item_id ?? ""} key={info?.unit?.item_id ?? "none"}>
                <option value="" disabled>Choose the model…</option>
                {items.map((i) => <option key={i.id} value={i.id}>{i.name} · {i.code}</option>)}
              </select></div>
            <div className="field"><label htmlFor="imei">IMEI</label>
              <input id="imei" name="imei" required value={imei} onChange={(e) => setImei(e.target.value)} inputMode="numeric" /></div>
          </div><History info={info} /></div>
        </div>
        <Inspection checks={checks} setChecks={setChecks} />
        <div className="card">
          <div className="card-head"><h2>Purchase</h2></div>
          <div className="card-body"><div className="row">
            <div className="field"><label htmlFor="location_id">Warehouse</label>
              <select id="location_id" name="location_id" required>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
            <div className="field"><label htmlFor="price">Buyback price (MMK)</label>
              <input id="price" name="price" type="number" min="1" required value={price} onChange={(e) => setPrice(e.target.value)} /></div>
            <div className="field"><label htmlFor="payment">Payment</label>
              <select id="payment" name="payment" value={payment} onChange={(e) => setPayment(e.target.value)}>
                <option value="NOW">Paid now</option><option value="LATER">Pay later (owed)</option></select></div>
            {payment === "NOW" && <div className="field"><label htmlFor="cash_account_id">From</label>
              <select id="cash_account_id" name="cash_account_id">{cashAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></div>}
            <div className="field"><label htmlFor="doc_date">Date</label><input id="doc_date" name="doc_date" type="date" defaultValue={today} required /></div>
          </div></div>
        </div>
        <div className="form-commit actions">
          <button type="submit" disabled={pending || !!info?.onShelf}>{pending ? "Posting…" : "Post purchase"}</button>
          <span className="page-sub">A purchase and goods receipt: Dr Inventory / Cr {payment === "NOW" ? "Cash or Bank" : "Accounts Payable"}.</span>
        </div>
      </form>
      <Summary rows={[["Phones", "1"], ["Payment", payment === "NOW" ? "Paid now" : "Owed to seller"]]}
        totalLabel="Buyback total" total={`${money(Number(price))} MMK`} />
    </div>
  );
}

export function TradeInForm({ action, items, locations, cashAccounts, today, canPayOut }: {
  action: (p: unknown, fd: FormData) => Promise<ActionResult>;
  items: Item[]; locations: Opt[]; cashAccounts: Opt[]; today: string; canPayOut: boolean;
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(action as never, null);
  useNotice(state);
  const [key] = useState(() => crypto.randomUUID());
  const [newImei, setNewImei] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [oldImei, setOldImei] = useState("");
  const [inspected, setInspected] = useState("");
  const [topUp, setTopUp] = useState("");
  const [checks, setChecks] = useState<Record<string, string>>({});
  const fresh = useImei(newImei);
  const old = useImei(oldImei);
  useEffect(() => { if (fresh?.unit?.price && !newPrice) setNewPrice(String(fresh.unit.price)); }, [fresh, newPrice]);

  const sale = Math.max(0, (Number(newPrice) || 0) - (Number(topUp) || 0));
  const allowance = (Number(inspected) || 0) + (Number(topUp) || 0);
  const diff = sale - (Number(inspected) || 0);
  const newOk = !!fresh?.onShelf;

  return (
    <div className="sh-layout">
      <form action={formAction} className="form wide docsheet">
        <input type="hidden" name="idempotency_key" value={key} />
        {state && "error" in state && <div className="alert">{state.error}</div>}
        <Seller label="Customer" />
        <div className="grid2">
          <div className="card">
            <div className="card-head"><h2>New phone</h2></div>
            <div className="card-body sh-stack">
              <div className="field"><label htmlFor="new_imei">IMEI</label>
                <input id="new_imei" name="new_imei" required value={newImei} onChange={(e) => setNewImei(e.target.value)} /></div>
              <input type="hidden" name="new_item_id" value={fresh?.unit?.item_id ?? ""} />
              {fresh && (fresh.onShelf
                ? <p className="hint">✓ {fresh.unit?.model} — in stock{fresh.unit?.used ? " (secondhand)" : ""}</p>
                : <p className="alert">Not in stock. Choose a phone on the shelf.</p>)}
              <div className="field"><label htmlFor="new_price">Selling price (MMK)</label>
                <input id="new_price" name="new_price" type="number" min="1" required value={newPrice} onChange={(e) => setNewPrice(e.target.value)} /></div>
            </div>
          </div>
          <div className="card">
            <div className="card-head"><h2>Customer&rsquo;s old phone</h2></div>
            <div className="card-body sh-stack">
              <div className="field"><label htmlFor="item_id">Model</label>
                <select id="item_id" name="item_id" required defaultValue={old?.unit?.item_id ?? ""} key={old?.unit?.item_id ?? "none"}>
                  <option value="" disabled>Choose the model…</option>
                  {items.map((i) => <option key={i.id} value={i.id}>{i.name} · {i.code}</option>)}
                </select></div>
              <div className="field"><label htmlFor="imei">IMEI</label>
                <input id="imei" name="imei" required value={oldImei} onChange={(e) => setOldImei(e.target.value)} /></div>
              <History info={old} />
              <div className="field"><label htmlFor="inspected_value">Inspected value (MMK)</label>
                <input id="inspected_value" name="inspected_value" type="number" min="1" required value={inspected} onChange={(e) => setInspected(e.target.value)} />
                <span className="hint">What the old phone is worth as stock</span></div>
              <div className="field"><label htmlFor="top_up">Promotion top-up (MMK)</label>
                <input id="top_up" name="top_up" type="number" min="0" value={topUp} onChange={(e) => setTopUp(e.target.value)} />
                <span className="hint">Extra allowance; posted as a discount on the new phone</span></div>
            </div>
          </div>
        </div>
        <Inspection checks={checks} setChecks={setChecks} />
        <div className="card">
          <div className="card-head"><h2>Settlement</h2></div>
          <div className="card-body"><div className="row">
            <div className="field"><label htmlFor="location_id">Branch / warehouse</label>
              <select id="location_id" name="location_id" required>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
            <div className="field"><label htmlFor="cash_account_id">{diff >= 0 ? "Customer pays into" : "Refund from"}</label>
              <select id="cash_account_id" name="cash_account_id" required>{cashAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></div>
            <div className="field"><label htmlFor="doc_date">Date</label><input id="doc_date" name="doc_date" type="date" defaultValue={today} required /></div>
          </div>
          {diff < 0 && (
            <label className="check" style={{ marginTop: 8 }}>
              <input type="checkbox" name="pay_excess" disabled={!canPayOut} />
              Pay the customer {money(-diff)} MMK now{canPayOut ? "" : " (needs purchase permission)"} — otherwise it stays owed to them as credit
            </label>
          )}</div>
        </div>
        <div className="form-commit actions">
          <button type="submit" disabled={pending || !newOk || !!old?.onShelf}>{pending ? "Posting…" : "Post trade-in"}</button>
          <span className="page-sub">Sale, old-phone purchase and settlement post together, or not at all.</span>
        </div>
      </form>
      <Summary
        rows={[["New phone", `${money(Number(newPrice))} MMK`], ...(Number(topUp) ? [["Promotion", `− ${money(Number(topUp))}`] as [string, string]] : []),
               ["Less trade-in", `− ${money(Number(inspected))}`], ["Trade-in allowance", `${money(allowance)} MMK`]]}
        totalLabel={diff >= 0 ? "Customer pays" : "Customer is owed"} total={`${money(Math.abs(diff))} MMK`} />
    </div>
  );
}
