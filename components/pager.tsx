import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Page } from "@/lib/paging";

/**
 * Previous / next under a long list, keeping every other filter in the URL.
 * Nothing is drawn when the list fits on one page. `name` lets a page with
 * two lists page them separately (?page= and ?docs=).
 */
export function Pager({ p, params, name = "page" }: {
  p: Page;
  params: Record<string, string | string[] | undefined>;
  name?: string;
}) {
  if (p.pages <= 1) return null;
  const href = (n: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (k === name || v == null) continue;
      for (const one of Array.isArray(v) ? v : [v]) q.append(k, one);
    }
    if (n > 1) q.set(name, String(n));
    const s = q.toString();
    return s ? `?${s}` : "?";
  };
  return (
    <nav className="dt-pager" aria-label="Pages">
      <span className="dt-pager-count">{p.from}–{p.to} of {p.total}</span>
      <span className="dt-spacer" />
      <span className="dt-pager-nav">
        {p.page > 1
          ? <Link className="dt-step" href={href(p.page - 1)} aria-label="Previous page"><ChevronLeft size={14} aria-hidden="true" /></Link>
          : <span className="dt-step" aria-disabled="true"><ChevronLeft size={14} aria-hidden="true" /></span>}
        <span className="dt-pager-page">{p.page} / {p.pages}</span>
        {p.page < p.pages
          ? <Link className="dt-step" href={href(p.page + 1)} aria-label="Next page"><ChevronRight size={14} aria-hidden="true" /></Link>
          : <span className="dt-step" aria-disabled="true"><ChevronRight size={14} aria-hidden="true" /></span>}
      </span>
    </nav>
  );
}
