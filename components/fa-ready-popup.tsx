"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clock, X } from "lucide-react";

/**
 * "October's depreciation is ready to post", with the button that opens it.
 * Stands in for automatic posting until a scheduled job exists: someone
 * allowed to post is told, and decides. Dismissed for the session per month.
 */
export function FaReadyPopup({ month, label, branches, amount }: { month: string; label: string; branches: number; amount: string }) {
  const key = `fa-ready:${month}`;
  const [shown, setShown] = useState(false);
  const path = usePathname();
  useEffect(() => { try { setShown(!sessionStorage.getItem(key)); } catch { setShown(true); } }, [key]);
  // Not over the calendar month that is already open for posting.
  if (!shown || path.startsWith("/fixed-assets/calendar")) return null;
  const year = month.slice(0, 4);
  return (
    <div className="fa-popup" role="status">
      <span className="fa-popup-ico"><Clock size={16} aria-hidden="true" /></span>
      <span className="fa-popup-body">
        <strong>{label} depreciation is ready to post</strong>
        <small>{branches} branch{branches === 1 ? "" : "es"} · {Number(amount).toLocaleString("en-US", { maximumFractionDigits: 0 })} MMK</small>
      </span>
      <Link className="ie-btn primary" href={`/fixed-assets/calendar?year=${year}&month=${month}&tab=journal`}>Review &amp; post</Link>
      <button type="button" className="fa-popup-x" aria-label="Dismiss"
        onClick={() => { try { sessionStorage.setItem(key, "1"); } catch { /* this view only */ } setShown(false); }}><X size={14} /></button>
    </div>
  );
}
