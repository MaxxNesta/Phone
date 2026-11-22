"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

const KEY = "appNavDepth";
const depth = () => { try { return Number(sessionStorage.getItem(KEY) ?? 0); } catch { return 0; } };

/**
 * Counts the pages this tab has shown inside the app, so a back arrow knows
 * whether there is a page of ours to go back to. Mounted once in the layout.
 */
export function NavTracker() {
  const path = usePathname();
  useEffect(() => {
    try { sessionStorage.setItem(KEY, String(depth() + 1)); } catch { /* storage refused */ }
  }, [path]);
  return null;
}

/**
 * A back arrow that goes back: to the page the person came from when they
 * came from one of ours, and to `href` (the list) when the document was
 * opened directly, from a link or a bookmark. Still a real link, so a middle
 * click or a new tab opens the list.
 */
export function BackLink({ href, className, children, ...rest }: {
  href: string; className?: string; children: React.ReactNode; "aria-label"?: string;
}) {
  const router = useRouter();
  return (
    <Link href={href} className={className} {...rest}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        if (depth() > 1 && window.history.length > 1) { e.preventDefault(); router.back(); }
      }}>
      {children}
    </Link>
  );
}
