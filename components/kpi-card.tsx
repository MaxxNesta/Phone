import { HelpHint } from "./help-hint";

/**
 * The inventory pages' KPI card: one quiet icon, the label with a "?" for the
 * detail, and the figure. Goes inside `.kpis.kpis-tiled.kpis-compact`.
 */
export function KpiCard({ icon, label, value, unit, hint, tone }: {
  icon: React.ReactNode; label: string; value: React.ReactNode; unit?: string; hint: string;
  /** Colours the figure only, for the one card that needs attention. */
  tone?: "bad" | "warn";
}) {
  return (
    <div className="kpi">
      <span className="kpi-icon" style={{ color: "var(--ink)", background: "var(--line-soft)" }}>{icon}</span>
      <span className="kpi-body">
        <span className="kpi-label">{label} <HelpHint label={label}>{hint}</HelpHint></span>
        <span className="kpi-value" style={{ color: tone === "bad" ? "var(--bad)" : tone === "warn" ? "var(--fa-amber)" : undefined }}>
          {value}{unit && <small className="ag-unit"> {unit}</small>}
        </span>
      </span>
    </div>
  );
}
