import type { ReactNode } from "react";
import { CountUp } from "./count-up";

/**
 * One KPI tile: the house's muted icon, label, figure, and a short note.
 *
 * Optional, for the tiles that have one: a change pill (blue up, red down),
 * or a 7-day trend with today solid. Each
 * animates once when the page opens and then stays still.
 */
export function Stat({ icon, tone, label, value, note, noteTone, delta, trend }: {
  icon: ReactNode; tone?: "violet" | "amber" | "slate"; label: string; value: ReactNode;
  note?: ReactNode; noteTone?: "up" | "down" | "warn";
  /** "▲ 30.5%" and which way is good news. */
  delta?: { text: string; good: boolean } | null;
  /** Oldest first; the last value is today. */
  trend?: number[];
}) {
  const max = trend ? Math.max(...trend, 0) : 0;
  return (
    <div className="stat">
      <span className={`stat-icon${tone ? ` ${tone}` : ""}`} aria-hidden="true">{icon}</span>
      <span className="stat-label">{label}</span>
      <span className="stat-value">
        {/* "2.48M MMK": the figure large, the unit small beside it. */}
        {typeof value === "string" ? (() => {
          const at = value.indexOf(" ");
          return at > 0
            ? <><CountUp text={value.slice(0, at)} /><small>{value.slice(at + 1)}</small></>
            : <CountUp text={value} />;
        })() : value}
      </span>
      {(delta || note) && (
        <span className="stat-foot">
          {delta && <span className={`pill ${delta.good ? "posted" : "overdue"} stat-delta`}>{delta.text}</span>}
          {note && <span className={`stat-note${noteTone ? ` ${noteTone}` : ""}`}>{note}</span>}
        </span>
      )}
      {trend && trend.length > 1 && max > 0 && (
        <span className="stat-trend" aria-hidden="true">
          {trend.map((v, i) => (
            <i key={i} style={{ height: `${Math.max(6, (v / max) * 100)}%`, animationDelay: `${0.25 + i * 0.04}s` }} />
          ))}
        </span>
      )}
    </div>
  );
}

/** 18,450,000 → 18.45M, for the tiles; tables keep full figures. */
export function compact(n: number) {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${(n / 1e3).toFixed(1)}K`;
  return Math.round(n).toLocaleString("en-US");
}
