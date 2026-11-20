"use client";

import { useEffect, useState } from "react";

export type DocTab = { id: string; label: string; count?: number; content: React.ReactNode };

/**
 * The tabs a posted document reads in — Details, Payments, Journal, Activity —
 * with the side panel beside whichever is open.
 *
 * Every pane stays mounted and only the chosen one shows. The panes hold real
 * forms — correcting, applying an advance, receiving — and unmounting one on a
 * tab switch would throw away whatever somebody had half typed into it.
 *
 * The chosen tab rides in the URL hash (#journal), so a link can open a
 * document on the tab it is about.
 */
export function DocTabs({ tabs, panel }: { tabs: DocTab[]; panel?: React.ReactNode }) {
  const [tab, setTab] = useState(tabs[0]?.id ?? "details");

  useEffect(() => {
    const read = () => {
      const h = window.location.hash.replace(/^#/, "");
      if (tabs.some((t) => t.id === h)) setTab(h);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, [tabs]);

  const choose = (id: string) => {
    setTab(id);
    // replaceState, not location.hash: a tab is a view of this page, not a
    // place in the history somebody has to press Back through.
    window.history.replaceState(null, "", id === tabs[0]?.id ? window.location.pathname + window.location.search : `#${id}`);
  };

  return (
    <>
      <nav className="dl-tabs" role="tablist" aria-label="Document">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" id={`dl-tab-${t.id}`} aria-controls={`dl-pane-${t.id}`}
            aria-selected={tab === t.id} className={tab === t.id ? "dl-tab on" : "dl-tab"} onClick={() => choose(t.id)}>
            {t.label}{t.count != null && ` (${t.count})`}
          </button>
        ))}
      </nav>
      <div className={`dl-body${panel ? " with-panel" : ""}`}>
        <div className="dl-main">
          {tabs.map((t) => (
            <div key={t.id} id={`dl-pane-${t.id}`} role="tabpanel" aria-labelledby={`dl-tab-${t.id}`}
              hidden={tab !== t.id} className="dl-pane">
              {t.content}
            </div>
          ))}
        </div>
        {panel && <aside className="dl-panel" aria-label="Where this document stands">{panel}</aside>}
      </div>
    </>
  );
}
