"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Menu, X } from "lucide-react";

/**
 * The till takes the whole screen; the navigation waits behind one button.
 *
 * On the counter-sale page the sidebar is not a rail beside the shelf but a
 * drawer over it: hidden until the menu button in the till's own header
 * opens it, closed again by a link, Escape or a tap on the dimmed page. The
 * nav itself is the same element as everywhere else; only CSS moves it, keyed
 * on <body data-pos> as the rest of the shell is (globals.css, "The till").
 *
 * The drawer always opens at full width with its labels. Someone who keeps the
 * rail collapsed to icons elsewhere still gets that on every other page: the
 * collapse is lifted here without touching the saved preference, and put back
 * from it on the way out.
 */
export function PosNavToggle() {
  const [open, setOpen] = useState(false);
  const n = useTranslations("nav");

  useEffect(() => {
    const b = document.body;
    b.dataset.pos = "true";
    b.dataset.navCollapsed = "false";
    return () => {
      b.dataset.pos = "false";
      b.dataset.posNav = "closed";
      let saved = false;
      try { saved = localStorage.getItem("navCollapsed") === "true"; } catch { /* storage refused */ }
      b.dataset.navCollapsed = saved ? "true" : "false";
    };
  }, []);

  useEffect(() => {
    document.body.dataset.posNav = open ? "open" : "closed";
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    // A link in the drawer lands on its page; the drawer should not stay over it.
    const onNav = (e: MouseEvent) => { if ((e.target as Element | null)?.closest?.("#sidebar a")) setOpen(false); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onNav);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("click", onNav); };
  }, [open]);

  return (
    <>
      <button type="button" className="pos-navbtn" aria-label={open ? n("closeMenu") : n("openMenu")}
        aria-expanded={open} aria-controls="sidebar" onClick={() => setOpen(!open)}>
        {open ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
      </button>
      <div className="pos-scrim" onClick={() => setOpen(false)} aria-hidden="true" />
    </>
  );
}
