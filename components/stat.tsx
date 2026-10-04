import type { ReactNode } from "react";

/** One KPI tile: tinted icon, label, figure, and a short coloured note. */
export function Stat({ icon, tone, label, value, note, noteTone }: {
  icon: ReactNode; tone?: "violet" | "amber" | "slate"; label: string; value: ReactNode;
  note?: ReactNode; noteTone?: "up" | "down" | "warn";
}) {
  return (
    <div className="stat">
      <span className={`stat-icon${tone ? ` ${tone}` : ""}`} aria-hidden="true">{icon}</span>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {note && <span className={`stat-note${noteTone ? ` ${noteTone}` : ""}`}>{note}</span>}
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
