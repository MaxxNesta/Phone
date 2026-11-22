/* The Executive page's own skeleton: its title, tabs, headline, four figures
   and two ruled sections, so the page does not jump when the figures land.
   Shown at once on the first visit and when the period changes; switching
   tabs needs no server and never shows it. */
export default function Loading() {
  return (
    <div className="xd skel-page" aria-busy="true" aria-label="Loading the Executive dashboard">
      <div className="xd-top">
        <h1 className="xd-title">Executive</h1>
        <div className="skel" style={{ width: 360, maxWidth: "50%", height: 22, marginRight: "auto" }} />
        <div className="skel" style={{ width: 150, height: 22 }} />
      </div>
      <div className="skel skel-sub" style={{ marginTop: 10 }} />
      <div className="skel" style={{ width: "62%", height: 36, marginTop: 28 }} />
      <div className="skel" style={{ width: "44%", height: 36 }} />
      <div className="skel-kpis" style={{ marginTop: 18 }}>
        {[0, 1, 2, 3].map((i) => <div key={i} className="skel skel-kpi" />)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr)", gap: 28, marginTop: 18 }}>
        <div className="skel" style={{ height: 300 }} />
        <div className="skel" style={{ height: 300 }} />
      </div>
      <div className="skel" style={{ height: 220 }} />
    </div>
  );
}
