"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import type { ActionResult } from "@/lib/actions";

/**
 * The second "yes" before a brand other than Apple exists. The shop sells
 * Apple; another brand shows up in every product list and filter, so the
 * owner is asked once more, plainly, before it is made.
 */
export function ConfirmOtherBrand({ open, name, busy, onCancel, onConfirm }: {
  open: boolean; name: string; busy?: boolean;
  onCancel: () => void; onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="confirm alertish"
      onCancel={(e) => { e.preventDefault(); if (!busy) onCancel(); }}
      onClick={(e) => { if (e.target === ref.current && !busy) onCancel(); }}>
      <div className="confirm-panel">
        <div className="confirm-icon" aria-hidden="true"><AlertTriangle size={18} strokeWidth={2.25} /></div>
        <h2 className="confirm-title">Are you sure you want to add {name ? <>&ldquo;{name}&rdquo;</> : "this brand"}?</h2>
        <div className="confirm-actions">
          <button type="button" className="ghost" autoFocus disabled={busy} onClick={onCancel}>Cancel</button>
          <button type="button" disabled={busy} onClick={onConfirm}>{busy ? "Adding…" : "Add brand"}</button>
        </div>
      </div>
    </dialog>
  );
}

export function AddBrandForm({
  action,
}: {
  action: (prev: unknown, fd: FormData) => Promise<ActionResult>;
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    action as never,
    null
  );
  const [open, setOpen] = useState(false);
  const [ask, setAsk] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [askName, setAskName] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => { if (confirmed) { formRef.current?.requestSubmit(); setConfirmed(false); } }, [confirmed]);

  if (!open) {
    return (
      <div className="actions">
        <button type="button" onClick={() => setOpen(true)}>+ Brand</button>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2>New brand</h2>
        <span className="actions">
          <button type="button" className="ghost tiny" onClick={() => setOpen(false)}>Cancel</button>
        </span>
      </div>
      <div className="card-body">
        <form ref={formRef} action={formAction} className="form"
          onSubmit={(e) => {
            if (confirmed) return;
            e.preventDefault();
            setAskName(String(new FormData(e.currentTarget).get("name") ?? ""));
            setAsk(true);
          }}>
          <input type="hidden" name="confirm_other_brand" value={confirmed ? "yes" : ""} />
          <ConfirmOtherBrand open={ask} name={askName} busy={pending}
            onCancel={() => setAsk(false)}
            onConfirm={() => { setAsk(false); setConfirmed(true); }} />
          {state && "error" in state && <div className="alert">{state.error}</div>}

          <div className="row">
            <div className="field">
              <label htmlFor="code">Code</label>
              <input id="code" name="code" type="text" required autoFocus placeholder="ADVICS" />
            </div>
            <div className="field">
              <label htmlFor="name">Name</label>
              <input id="name" name="name" type="text" required placeholder="Advics" />
            </div>
            <div className="field">
              <label htmlFor="name_my">Name (Burmese)</label>
              <input id="name_my" name="name_my" type="text" />
            </div>
          </div>

          <div className="actions">
            <button type="submit" disabled={pending}>{pending ? "Saving…" : "Save brand"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
