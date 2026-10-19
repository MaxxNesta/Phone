import Link from "next/link";
import { Fragment } from "react";
import { ArrowLeft } from "lucide-react";

/**
 * A document page's heading in one row: back, where it sits, what it is and
 * where it stands. Shared by order, receipt and invoice entry so they open the
 * same way and give the lines the height a stacked crumb-and-title took.
 */
export function DocHeading({ back, trail, title, status, badges, children }: {
  /** Where the arrow goes: the list, or the document this one was raised from. */
  back: { href: string; label: string };
  /** The steps before the title — "Purchase orders", or the order being received. */
  trail: { label: string; href: string }[];
  title: string;
  /** "New" or "Draft". */
  status?: string;
  /** Beside the status: the price level a sales invoice is being priced at. */
  badges?: React.ReactNode;
  /** Help and any page-level link, at the end of the row. */
  children?: React.ReactNode;
}) {
  return (
    <div className="doc-heading">
      <Link href={back.href} className="doc-heading-back" aria-label={back.label}>
        <ArrowLeft size={18} aria-hidden="true" />
      </Link>
      <nav className="doc-heading-trail" aria-label="Breadcrumb">
        {trail.map((t) => (
          <Fragment key={t.href}>
            <Link href={t.href}>{t.label}</Link>
            <span aria-hidden="true">/</span>
          </Fragment>
        ))}
      </nav>
      <h1>{title}</h1>
      {status && <span className={`pill${status === "Draft" ? " draft" : ""}`}>{status}</span>}
      {badges}
      {children && <div className="doc-heading-aside">{children}</div>}
    </div>
  );
}
