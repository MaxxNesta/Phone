import type { ReactNode } from "react";
import { CircleAlert, Info } from "lucide-react";

/**
 * A field that wants attention, said on the field: the input as it is, with a
 * small exclamation inside it whose hover says why. Nothing shouts above the
 * form; the reason sits where the fix is typed.
 */
export function Flagged({ note, children }: { note?: string | false | null; children: ReactNode }) {
  if (!note) return <>{children}</>;
  return (
    <span className="flagged">
      {children}
      <span className="cell-flag" title={note} aria-label={note} role="img">
        <CircleAlert size={14} aria-hidden="true" />
      </span>
    </span>
  );
}

/** A calm note under the lines: for what a cell flag cannot carry, such as a link. */
export function DocNote({ children }: { children: ReactNode }) {
  return (
    <div className="doc-note" role="status">
      <Info size={15} aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}
