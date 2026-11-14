"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Lock } from "lucide-react";

/** Raised by useNotice when an action is refused for want of a permission. */
export const DENIED_EVENT = "erp:denied";

/** What a permission is called, in words a person reads. */
const WHAT: Record<string, string> = {
  "pos.sell": "the counter sale", "sales.view": "sales", "sales.post": "posting sales",
  "sales.return": "returns and credit notes", "documents.void": "voiding and correcting documents",
  "discount.unlimited": "discounts above the limit", "cost.view": "costs and margins",
  "purchase.view": "purchases", "purchase.post": "posting purchases",
  "inventory.view": "inventory", "inventory.manage": "receiving, transferring and adjusting stock",
  "partners.manage": "customers and suppliers", "items.manage": "products",
  "accounting.view": "accounting", "accounting.post": "posting to the books", "reports.view": "reports",
  "settings.manage": "settings", "users.manage": "users", "receipts.manage": "receipt templates",
};
const nameOf = (perm: string | null) => (perm && WHAT[perm]) || (perm?.startsWith("hr.") ? "HR & Payroll" : "this");

function Dialog() {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const ref = useRef<HTMLDialogElement>(null);
  const [perm, setPerm] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);

  // A page refused at the door arrives here with ?denied=<permission>.
  useEffect(() => {
    const d = params.get("denied");
    if (d) { setPerm(d); setDetail(null); }
  }, [params]);

  // An action refused on the server says so in its error.
  useEffect(() => {
    const on = (e: Event) => {
      const msg = (e as CustomEvent<string>).detail;
      setPerm(/\(([a-z.]+)\)/.exec(msg)?.[1] ?? null);
      setDetail(msg);
    };
    window.addEventListener(DENIED_EVENT, on);
    return () => window.removeEventListener(DENIED_EVENT, on);
  }, []);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if ((perm || detail) && !d.open) d.showModal();
  }, [perm, detail]);

  const close = () => {
    ref.current?.close();
    setPerm(null); setDetail(null);
    if (params.get("denied")) {
      const next = new URLSearchParams(params.toString());
      next.delete("denied");
      router.replace(next.size ? `${path}?${next}` : path, { scroll: false });
    }
  };

  return (
    <dialog ref={ref} className="denied" onCancel={(e) => { e.preventDefault(); close(); }}
            onClick={(e) => { if (e.target === ref.current) close(); }} aria-labelledby="denied-title">
      <div className="denied-panel">
        <span className="denied-icon"><Lock size={22} aria-hidden="true" /></span>
        <h2 id="denied-title">You don’t have access</h2>
        <p>
          Your role doesn’t include {nameOf(perm)}. Ask an administrator if you need it.
        </p>
        {detail && <p className="denied-detail">{detail}</p>}
        <button type="button" className="btn primary" onClick={close} autoFocus>OK</button>
      </div>
    </dialog>
  );
}

/** One per page, in the layout: shows itself when a page or an action is refused. */
export function DeniedDialog() {
  return <Suspense fallback={null}><Dialog /></Suspense>;
}
