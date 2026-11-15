/**
 * Shown the instant a page is asked for, while the server builds it: the
 * sidebar stays, the content area sketches a heading, a row of figures and a
 * table. Every route shares it, so navigation never looks frozen.
 */
export default function Loading() {
  return (
    <div className="skel-page" role="status" aria-label="Loading">
      <div className="skel skel-title" />
      <div className="skel skel-sub" />
      <div className="skel-kpis">
        {[0, 1, 2, 3].map((i) => <div key={i} className="skel skel-kpi" />)}
      </div>
      <div className="skel-card">
        {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="skel skel-row" style={{ width: `${92 - (i % 3) * 14}%` }} />)}
      </div>
    </div>
  );
}
