"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { bulkDeleteItems } from "@/lib/actions";
import { useTranslations } from "next-intl";

/** Ticks or clears every row checkbox on the page. */
export function PickPage() {
  const c = useTranslations("common");
  return (
    <input type="checkbox" aria-label={c("selectPage")}
      onChange={(e) => document.querySelectorAll<HTMLInputElement>("input.bulk-pick")
        .forEach((b) => { b.checked = e.target.checked; b.dispatchEvent(new Event("change", { bubbles: true })); })} />
  );
}

/**
 * Deletes the ticked products, or everything the filters show. Asked once,
 * with the count and the first few names, because it cannot be undone.
 */
export function BulkDelete({ shown, filtered }: {
  /** Every product the current filters match, across all pages: id → name. */
  shown: { id: string; name: string }[];
  /** Whether any filter is on: "delete all shown" is offered only then. */
  filtered: boolean;
}) {
  const t = useTranslations("bulkDelete");
  const c = useTranslations("common");
  const [picked, setPicked] = useState<string[]>([]);
  const [ask, setAsk] = useState<string[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const read = () => setPicked([...document.querySelectorAll<HTMLInputElement>("input.bulk-pick:checked")].map((b) => b.value));
    document.addEventListener("change", read);
    return () => document.removeEventListener("change", read);
  }, []);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (ask && !d.open) d.showModal();
    if (!ask && d.open) d.close();
  }, [ask]);

  const nameOf = new Map(shown.map((s) => [s.id, s.name]));
  const go = () => {
    const ids = ask ?? [];
    start(async () => {
      const r = await bulkDeleteItems(ids);
      setAsk(null);
      setMsg("ok" in r ? r.ok : r.error);
      document.querySelectorAll<HTMLInputElement>("input.bulk-pick").forEach((b) => { b.checked = false; });
      setPicked([]);
      router.refresh();
    });
  };

  return (
    <span className="actions">
      {msg && <span className="page-sub">{msg}</span>}
      {picked.length > 0 && (
        <button type="button" className="danger" onClick={() => setAsk(picked)}>
          <Trash2 size={14} aria-hidden="true" /> {t("deleteSelected", { n: picked.length })}
        </button>
      )}
      {filtered && picked.length === 0 && shown.length > 0 && (
        <button type="button" className="danger" onClick={() => setAsk(shown.map((s) => s.id))}>
          <Trash2 size={14} aria-hidden="true" /> {t("deleteShown", { n: shown.length })}
        </button>
      )}
      <dialog ref={ref} className="confirm alertish"
        onCancel={(e) => { e.preventDefault(); if (!busy) setAsk(null); }}
        onClick={(e) => { if (e.target === ref.current && !busy) setAsk(null); }}>
        {ask && (
          <div className="confirm-panel">
            <div className="confirm-icon" aria-hidden="true"><Trash2 size={18} strokeWidth={2.25} /></div>
            <h2 className="confirm-title">{t("confirmTitle", { n: ask.length })}</h2>
            <p className="confirm-detail">{t("confirmDetail")}</p>
            <ul className="alert-items">
              {ask.slice(0, 4).map((id) => <li key={id}><span>{nameOf.get(id) ?? t("product")}</span></li>)}
              {ask.length > 4 && <li><span className="page-sub">{t("andMore", { n: ask.length - 4 })}</span></li>}
            </ul>
            <div className="confirm-actions">
              <button type="button" className="ghost" autoFocus disabled={busy} onClick={() => setAsk(null)}>{c("cancel")}</button>
              <button type="button" className="danger-solid" disabled={busy} onClick={go}>
                {busy ? t("deleting") : c("delete")}
              </button>
            </div>
          </div>
        )}
      </dialog>
    </span>
  );
}
