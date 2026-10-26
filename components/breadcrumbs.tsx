import Link from "next/link";
import { ChevronRight } from "lucide-react";

/** Where this page sits: links down to the last, which is where you are. */
export function Breadcrumbs({ trail }: { trail: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="crumbs">
      <ol>
        {trail.map((c, i) => {
          const last = i === trail.length - 1;
          return (
            <li key={`${c.label}-${i}`}>
              {c.href && !last ? <Link href={c.href}>{c.label}</Link>
                : <span aria-current={last ? "page" : undefined}>{c.label}</span>}
              {!last && <ChevronRight size={12} aria-hidden="true" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
