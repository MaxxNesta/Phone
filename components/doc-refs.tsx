import Link from "next/link";
import { Fragment } from "react";

/** Document numbers as links to each document, comma-separated; a dash when there are none. */
export function DocRefs({ refs, newTab }: { refs: { id: string; no: string }[] | null | undefined; newTab?: boolean }) {
  if (!refs || refs.length === 0) return <>—</>;
  return (
    <>
      {refs.map((r, i) => (
        <Fragment key={r.id}>
          {i > 0 && ", "}
          <Link href={`/documents/${r.id}`} target={newTab ? "_blank" : undefined} style={{ color: "var(--link)" }}>{r.no}</Link>
        </Fragment>
      ))}
    </>
  );
}
