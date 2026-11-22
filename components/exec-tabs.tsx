"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/**
 * The Executive page's tabs, switched in the browser.
 *
 * Every tab is a view of the same figures for the same period, so asking the
 * server again on each click re-ran every query for nothing and the page sat
 * still until it answered. All panes arrive with the page; a click shows one
 * and writes the tab into the address, so a reload or a shared link opens on
 * it. The period still goes to the server: that is new data.
 */
export function ExecTabs({ title, dateline, tabs, spans, period, initial }: {
  title: React.ReactNode;
  dateline: React.ReactNode;
  tabs: { id: string; label: string; content: React.ReactNode }[];
  spans: { key: string; label: string }[];
  period: string;
  initial: string;
}) {
  const [tab, setTab] = useState(tabs.some((t) => t.id === initial) ? initial : tabs[0].id);
  /* A pane under display:none is never laid out, so its first showing paid
     for it — 250–450 ms on the chart-heavy tabs. Once the page is idle the
     other panes are laid out in a zero-height box instead (still out of
     sight, out of the tab order and out of the accessibility tree), so a
     click only swaps which one is visible. */
  const [warm, setWarm] = useState(false);
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((f: () => void) => window.setTimeout(f, 300));
    const cancel = window.cancelIdleCallback ?? window.clearTimeout;
    const id = idle(() => setWarm(true));
    return () => cancel(id);
  }, []);
  const href = (t: string, p: string) => `/reports/executive?${new URLSearchParams({ tab: t, p })}`;
  return (
    <>
      <div className="xd-top">
        {title}
        <nav className="xd-tabs" aria-label="Sections">
          {tabs.map((t) => (
            <a key={t.id} href={href(t.id, period)} aria-current={t.id === tab ? "page" : undefined}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                e.preventDefault();
                setTab(t.id);
                window.history.replaceState(window.history.state, "", href(t.id, period));
              }}>{t.label}</a>
          ))}
        </nav>
        <nav className="xd-spans" aria-label="Period">
          {spans.map((s) => (
            <Link key={s.key} href={href(tab, s.key)} aria-current={s.key === period ? "true" : undefined} title={s.key}>{s.label}</Link>
          ))}
        </nav>
      </div>
      {dateline}
      {tabs.map((t) => t.id === tab
        ? <div key={t.id}>{t.content}</div>
        : warm
          ? <div key={t.id} className="xd-pane-off" inert aria-hidden="true">{t.content}</div>
          : <div key={t.id} hidden>{t.content}</div>)}
    </>
  );
}
