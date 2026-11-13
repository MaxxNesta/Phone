import { CircleCheck, CircleDot, FileText, Landmark, PackageCheck } from "lucide-react";
import { shortDate } from "@/lib/db";
import type { DocEvent, Person } from "./document-rail";

/**
 * What happened to this document, and what it is joined to — under it, not
 * beside it.
 *
 * Down the right they cost the lines a fifth of the page: the table is the
 * part somebody reads across, and a history nobody consults until something
 * is wrong was squeezing it. At the foot they are where a reader arrives
 * having already read the document, which is when either becomes interesting.
 *
 * The links take three quarters: they are a table of documents somebody
 * follows, with numbers, dates and quantities across. The history takes one
 * and reads down.
 */

const ICON: Record<string, typeof CircleDot> = {
  POSTED: CircleCheck,
  CREATED: FileText,
  STOCK: PackageCheck,
  BANK: Landmark,
};

const time = (v: unknown) =>
  v ? new Date(String(v)).toLocaleTimeString("en-GB",
    { hour: "2-digit", minute: "2-digit" }) : "";

export function DocumentFooter({
  activity, related, createdBy, postedBy, postedAt, createdAt,
}: {
  createdAt?: string | null;
  activity: DocEvent[];
  related: React.ReactNode;
  createdBy: Person;
  postedBy: Person;
  postedAt: string | null;
}) {
  /* Nothing logged is not nothing known: the document itself says who raised
     it and who posted it, so the timeline always has those two to show. */
  const events: DocEvent[] = activity.length > 0 ? activity : [
    ...(postedAt ? [{ kind: "POSTED", note: "Posted", happened_at: postedAt,
      actor: postedBy.name, initials: postedBy.initials }] : []),
    ...(createdAt ? [{ kind: "CREATED", note: "Created", happened_at: createdAt,
      actor: createdBy.name, initials: createdBy.initials }] : []),
  ];
  return (
    <div className="docfooter">
      <div className="docfooter-links">{related}</div>

      <section className="card docfooter-history">
        <div className="card-head">
          <h2>Activity</h2>
          <span className="page-sub">who did what, and when</span>
        </div>
        <div className="card-body">
          {events.length === 0 ? (
            <p className="hint">Nothing recorded yet.</p>
          ) : (
            <ol className="timeline">
              {events.map((e, i) => {
                const Icon = ICON[e.kind] ?? CircleDot;
                return (
                  <li key={`${e.happened_at}-${i}`} className={i === 0 ? "now" : ""}>
                    <span className="timeline-icon"><Icon size={14} aria-hidden="true" /></span>
                    <div>
                      <strong>
                        {e.note ?? e.kind.toLowerCase()}
                        {e.actor && <span className="timeline-who"> by {e.actor}</span>}
                      </strong>
                      <span className="page-sub">
                        {shortDate(e.happened_at)}, {time(e.happened_at)}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </section>
    </div>
  );
}
