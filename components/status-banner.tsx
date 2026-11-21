import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";

/**
 * A status said in one sentence, the Astryx way (app/erp/retail.css,
 * `.sbanner`): an icon, a title, a quieter line under it, and the actions
 * that answer it at the end. `info` for a standing fact, `ok` for something
 * done, `warn` for something waiting on someone, `bad` for a problem.
 */
export function StatusBanner({ tone = "info", title, description, actions, className }: {
  tone?: "info" | "ok" | "warn" | "bad";
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  const Icon = tone === "ok" ? CheckCircle2 : tone === "warn" ? AlertTriangle : tone === "bad" ? XCircle : Info;
  return (
    <div className={`sbanner${className ? ` ${className}` : ""}`} data-tone={tone} role={tone === "bad" ? "alert" : "status"}>
      <Icon size={18} className="sbanner-icon" aria-hidden="true" />
      <div className="sbanner-text">
        <div className="sbanner-title">{title}</div>
        {description && <div className="sbanner-desc">{description}</div>}
      </div>
      {actions && <div className="sbanner-actions">{actions}</div>}
    </div>
  );
}

/** A small tinted status badge (`.sbadge`). */
export function StatusBadge({ tone, children }: { tone?: "info" | "ok" | "warn" | "bad"; children: ReactNode }) {
  return <span className="sbadge" data-tone={tone}>{children}</span>;
}
