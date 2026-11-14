"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/actions";
import { PLAN_NAME, PLAN_COMPARISON, type Plan, type PlanLimits } from "@/lib/plans";
import { Check } from "lucide-react";
import { Fragment } from "react";
import { useNotice } from "@/components/toast";

const ORDER: Plan[] = ["STARTER", "BUSINESS", "ENTERPRISE"];

const BLURB: Record<Plan, string> = {
  STARTER: "Everything to sell, buy and keep the books",
  BUSINESS: "Adds the detailed reports and statements",
  ENTERPRISE: "Adds planning and advanced analysis",
};

/**
 * Switching the package, and showing what each one allows.
 *
 * A limit nobody has decided shows as "not decided" rather than as a dash or
 * an infinity sign. Both of those read as answers; this is an open question,
 * and the screen should not quietly close it.
 *
 * What the company already holds is shown beside each limit, because the
 * interesting thing about a limit is whether you are over it — and on both
 * live databases the branch count already exceeds Starter's.
 */
export function PlanSwitcher({
  current, limits, have, locked, action,
}: {
  current: Plan;
  limits: Record<Plan, PlanLimits>;
  have: { branches: number; warehouses: number };
  /** Production: shown, not switchable. */
  locked: boolean;
  action: (prev: unknown, fd: FormData) => Promise<ActionResult>;
}) {
  const [state, formAction, working] = useActionState<ActionResult | null, FormData>(
    action as never, null,
  );
  useNotice(state);

  const router = useRouter();
  useEffect(() => {
    if (state && "ok" in state) router.refresh();
  }, [state, router]);

  const cell = (limit: number | null, held: number) => {
    if (limit === null) {
      return <span style={{ color: "var(--muted)" }}>not decided</span>;
    }
    const over = held > limit;
    return (
      <>
        <strong style={{ color: over ? "var(--warn)" : undefined }}>{limit}</strong>
        <div className="subline">
          {held} in use{over && " — over this limit"}
        </div>
      </>
    );
  };

  return (
    <>
      {state && "error" in state && <div className="alert">{state.error}</div>}

      {/* One table: what each package includes, row by row, with the
          company's own package picked out by its column. */}
      <section className="card plan-table-card">
        <div className="tablewrap">
          <table className="plan-table">
            <colgroup>
              <col className="plan-feat-col" />
              {ORDER.map((p) => <col key={p} className={p === current ? "plan-here-col" : undefined} />)}
            </colgroup>
            <thead>
              <tr>
                <th className="plan-corner">
                  <span className="plan-corner-title">Compare packages</span>
                  <span className="subline">You are on {PLAN_NAME[current]}</span>
                </th>
                {ORDER.map((p) => {
                  const here = p === current;
                  return (
                    <th key={p} className={`plan-head${here ? " here" : ""}`}>
                      {here ? <span className="plan-badge">Current</span> : <span className="plan-badge-space" />}
                      <span className="plan-name">{PLAN_NAME[p]}</span>
                      <span className="plan-blurb">{BLURB[p]}</span>
                      <span className="plan-cta">
                        {here ? (
                          <span className="btn plan-btn is-current" aria-disabled="true">Your package</span>
                        ) : locked ? (
                          <span className="btn plan-btn ghost" aria-disabled="true">Ask your provider</span>
                        ) : (
                          <form action={formAction}>
                            <input type="hidden" name="plan" value={p} />
                            <button type="submit" className="btn plan-btn" disabled={working}>Switch</button>
                          </form>
                        )}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              <tr className="plan-group"><th colSpan={4}>Users</th></tr>
              <tr>
                <td>Users included <span className="subline">more as bought seats</span></td>
                {ORDER.map((p) => <td key={p} className={`c${p === current ? " here" : ""}`}>{limits[p].users ?? "—"}</td>)}
              </tr>
              <tr>
                <td>Branches and warehouses</td>
                {ORDER.map((p) => <td key={p} className={`c${p === current ? " here" : ""}`}>Unlimited</td>)}
              </tr>
              {PLAN_COMPARISON.map((g) => (
                <Fragment key={g.group}>
                  <tr className="plan-group"><th colSpan={4}>{g.group}</th></tr>
                  {g.lines.map((ln) => (
                    <tr key={ln.label}>
                      <td>{ln.label}</td>
                      {ORDER.map((p) => (
                        <td key={p} className={`c${p === current ? " here" : ""}`}>
                          {ln.in.includes(p)
                            ? <Check size={16} aria-label="included" className="plan-yes" />
                            : <span className="plan-no" aria-label="not included" />}
                        </td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div className="card">
          <div className="card-body">
            <div className="hintbar caution">
              {locked
                ? <><strong>Need more?</strong> Contact your provider to change the package, add modules or add user seats.</>
                : <><strong>Test site:</strong> the package, modules and user seats can be changed here. In production only the provider can change them.</>}
              {" "}A company already over its user seats keeps everyone it has and is
              refused only when adding more.
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
