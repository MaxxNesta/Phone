import Link from "next/link";
import { BackLink } from "@/components/back-link";
import {
  ArrowLeft, Calendar, Check, ChevronDown, Circle, CircleDot, Plus,
  CreditCard, FileText, PencilLine, Undo2, XCircle, Printer, Paperclip, RefreshCw, Truck, PackageCheck,
} from "lucide-react";
import { ErpCopyNumber } from "@/components/erp-doc-toolbar";
import { DocTabs, type DocTab } from "@/components/doc-tabs";
import type { ChainStage } from "@/components/erp-doc-shell";

export type StatusTone = "ok" | "warn" | "bad" | "info" | "neutral";

/** Two letters for a name, the way an avatar reads it. */
export function initialsOf(name: string | null | undefined): string {
  const w = String(name ?? "").replace(/\(.*?\)/g, " ").trim().split(/\s+/).filter(Boolean);
  return ((w[0]?.[0] ?? "") + (w[1]?.[0] ?? "")).toUpperCase() || "·";
}

/**
 * The frame a posted document is read in.
 *
 * The header says what it is and how it stands — who it is with, its state,
 * when, when due — with everything it lets you do on the right. Under it the
 * tabs, each with one job: Details is what the document says, Payments where
 * the money stands, Journal what it did to the books, Activity who did what.
 * Beside them a narrow panel: where it stands, its chain, what it is joined to.
 *
 * Presentation only. Every figure and every action is computed by the page and
 * handed in; this decides where things sit, never what they are.
 */
export function DocLayout({
  backHref, backLabel, listHref, listLabel, typeLabel, docNo, status, statusTone, badges, summary,
  partner, date, due, dueLate, actions, tabs, panel,
}: {
  backHref?: string | null;
  backLabel?: string | null;
  listHref: string;
  listLabel: string;
  typeLabel: string;
  docNo: string;
  /** What the pill says: Paid, Overdue, Voided… or the posting status. */
  status: string;
  statusTone?: StatusTone;
  badges?: React.ReactNode;
  summary?: React.ReactNode;
  partner?: { name: string; href?: string | null } | null;
  date?: string | null;
  due?: string | null;
  dueLate?: boolean;
  actions?: React.ReactNode;
  tabs: DocTab[];
  panel?: React.ReactNode;
}) {
  const word = status.charAt(0) + status.slice(1).toLowerCase();
  return (
    <div className="dl">
      <header className="dl-head">
        <div className="dl-head-id">
          <BackLink href={backHref ?? listHref} className="dl-back">
            <ArrowLeft size={15} aria-hidden="true" /> {backHref ? backLabel ?? "Back" : listLabel}
          </BackLink>
          <div className="dl-title">
            <h1>{typeLabel} {docNo}</h1>
            <ErpCopyNumber docNo={docNo} />
          </div>
          <div className="dl-meta">
            {[
              partner ? (
                <span key="who" className="dl-who">
                  <span className="dl-avatar" aria-hidden="true">{initialsOf(partner.name)}</span>
                  {partner.href ? <Link href={partner.href}>{partner.name}</Link> : partner.name}
                </span>
              ) : null,
              <span key="state" className="dl-states"><span className={`dl-pill ${statusTone ?? "neutral"}`}>{word}</span>{badges}</span>,
              date ? <span key="date" className="dl-when"><Calendar size={14} aria-hidden="true" /> {date}</span> : null,
              due ? <span key="due" className={`dl-when${dueLate ? " late" : ""}`}>Due {due}</span> : null,
              summary ? <span key="sum" className="dl-when">{summary}</span> : null,
            ].filter(Boolean).flatMap((el, i) => (i === 0 ? [el] : [<span key={`dot${i}`} className="dl-dot" aria-hidden="true">·</span>, el]))}
          </div>
        </div>
        {actions && <div className="dl-actions">{actions}</div>}
      </header>
      <DocTabs tabs={tabs} panel={panel} />
    </div>
  );
}

/** A heading in the side panel that folds its content away, open to begin with. */
export function DocPanelSection({ title, children, open = true }: { title: string; children: React.ReactNode; open?: boolean }) {
  return (
    <details className="dl-psec" open={open}>
      <summary><span>{title}</span><ChevronDown size={16} aria-hidden="true" /></summary>
      <div className="dl-psec-body">{children}</div>
    </details>
  );
}

/** A section of a tab: a heading, a count or caption beside it, and its content. */
export function DocSection({ title, count, caption, end, children }: {
  title: string; count?: string | null; caption?: string | null; end?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="dl-sec">
      <div className="dl-sec-head">
        <h2>{title}</h2>
        {count && <span className="dl-count">{count}</span>}
        {caption && <span className="dl-caption">{caption}</span>}
        {end && <span className="dl-sec-end">{end}</span>}
      </div>
      {children}
    </section>
  );
}

/** How much of the money is in: a bar, and the sentence it stands for. */
export function DocPaymentMeter({ paid, credited, total, outstanding, overdue, unit }: {
  paid: number; credited: number; total: number; outstanding: number; overdue: boolean; unit: string;
}) {
  const f = (n: number) => `${Math.round(n).toLocaleString("en-US")} ${unit}`;
  const pct = total > 0 ? Math.min(100, ((paid + credited) / total) * 100) : 0;
  return (
    <div className="dl-meter-wrap">
      <div className={`dl-meter${overdue ? " late" : outstanding > 0.005 ? " open" : ""}`} role="img"
        aria-label={`${Math.round(pct)}% settled`}><i style={{ width: `${pct}%` }} /></div>
      <p className="dl-meter-read">
        <strong>{f(paid)}</strong> paid{credited > 0.005 ? `, ${f(credited)} returned` : ""} of {f(total)}
      </p>
      {outstanding > 0.005 && <p className="dl-meter-due">{f(outstanding)} still due{overdue ? ", overdue" : ""}</p>}
    </div>
  );
}

export type DocEventIcon = "created" | "posted" | "paid" | "returned" | "corrected" | "voided" | "printed" | "attached" | "moved" | "received" | "other";
const EV_ICON = {
  created: PencilLine, posted: FileText, paid: CreditCard, returned: Undo2, corrected: RefreshCw, voided: XCircle,
  printed: Printer, attached: Paperclip, moved: Truck, received: PackageCheck, other: CircleDot,
} as const;

/** Who did what, newest first: an avatar, the event in a quiet card, when. */
export function DocTimeline({ events }: {
  events: { at: string; when: string; who: string; icon: DocEventIcon; text: React.ReactNode }[];
}) {
  if (events.length === 0) return <p className="dl-quiet">Nothing recorded yet.</p>;
  return (
    <ol className="dl-time">
      {events.map((e, i) => {
        const I = EV_ICON[e.icon] ?? CircleDot;
        return (
          <li key={i}>
            <span className="dl-avatar lg" aria-hidden="true">{initialsOf(e.who)}</span>
            <div>
              <div className="dl-time-card"><I size={15} aria-hidden="true" /><span><strong>{e.who}</strong> {e.text}</span></div>
              <span className="dl-time-at">{e.when}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** A short list in the side panel: a document, what it is and when, its figure. */
export function DocPanelList({ items, empty }: {
  items: { id: string; title: string; sub: string; end?: string | null; href?: string | null }[]; empty?: string;
}) {
  if (items.length === 0) return empty ? <p className="dl-quiet">{empty}</p> : null;
  return (
    <ul className="dl-plist">
      {items.map((x) => {
        const body = (<><span className="dl-plist-text"><span>{x.title}</span><small>{x.sub}</small></span>{x.end && <b>{x.end}</b>}</>);
        return <li key={x.id}>{x.href ? <Link href={x.href}>{body}</Link> : <div>{body}</div>}</li>;
      })}
    </ul>
  );
}

/**
 * The chain, top to bottom: each stage, the documents at it, and — for the
 * very next step — where to create it. Every document named is a link, and a
 * stage holding several lists them all rather than the first one found.
 */
export function DocFlow({ chain, docNo, notes }: { chain: ChainStage[]; docNo: string; notes?: Record<string, string> }) {
  if (chain.length === 0) return null;
  return (
    <ol className="dl-flow">
      {chain.map((stage) => {
        const docs = stage.docs && stage.docs.length > 0 ? stage.docs : stage.doc ? [stage.doc] : [];
        const here = docs.some((d) => d.doc_no === docNo);
        const done = docs.length > 0;
        const state = here ? "here" : done ? "done" : stage.optional ? "optional" : "todo";
        const note = notes?.[stage.type];
        return (
          <li key={stage.type} className={`dl-flow-step ${state}`} aria-current={here ? "step" : undefined}
            title={!done && stage.optional ? `${stage.label} is optional — this chain is valid without one` : undefined}>
            <span className="dl-flow-dot" aria-hidden="true">
              {here ? <CircleDot size={18} /> : done ? <Check size={11} strokeWidth={3.2} /> : <Circle size={16} />}
            </span>
            <div className="dl-flow-text">
              <span className="dl-flow-label">{stage.label}</span>
              {docs.map((d) => (d.doc_no === docNo
                ? <span key={d.id} className="dl-flow-sub">{d.doc_no}{note ? ` · ${note}` : ""}</span>
                : <Link key={d.id} href={`/documents/${d.id}`} className="dl-flow-sub link">{d.doc_no}</Link>))}
              {!done && stage.href && (
                <Link href={stage.href} className="dl-flow-sub link"><Plus size={12} aria-hidden="true" /> Create</Link>
              )}
              {!done && !stage.href && <span className="dl-flow-sub">{note ?? (stage.optional ? "Not used" : "Not yet")}</span>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
