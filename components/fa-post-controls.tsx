"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Play } from "lucide-react";
import type { ActionResult } from "@/lib/actions";
import { useNotice } from "@/components/toast";

export type BranchPosting = {
  branchId: string; branch: string; amount: string; assets: number;
  run: { id: string; status: string; docId: string | null; docNo: string | null } | null;
};

const kyat = (s: string) => Number(s).toLocaleString("en-US", { maximumFractionDigits: 0 });

/**
 * Review & post, per branch: prepare the month as a draft (the voucher is
 * shown in Journal and Impact), then post it. A posted month links to its
 * voucher; nothing here edits one.
 */
export function FaPostControls({ month, branches, prepare, post, discard, mode, canPost }: {
  month: string; branches: BranchPosting[]; mode: string; canPost: boolean;
  prepare: (p: unknown, fd: FormData) => Promise<ActionResult>;
  post: (p: unknown, fd: FormData) => Promise<ActionResult>;
  discard: (fd: FormData) => Promise<void>;
}) {
  const [pState, prepareAction, preparing] = useActionState<ActionResult | null, FormData>(prepare as never, null);
  useNotice(pState);
  const [qState, postAction, posting] = useActionState<ActionResult | null, FormData>(post as never, null);
  useNotice(qState, { ok: qState && "ok" in qState ? `${qState.draftId}. The ledger, the calendar and the asset schedules now show it.` : undefined });
  if (branches.length === 0) return null;
  const err = (pState && "error" in pState && pState.error) || (qState && "error" in qState && qState.error);
  return (
    <div className="fap">
      {err && <div className="alert" role="alert">{err}</div>}
      {mode === "MANUAL" && <p className="fa-muted">Posting is set to Manual. Post the journal yourself and link it in Journal Reconciliation.</p>}
      {branches.map((b) => (
        <div key={b.branchId} className="fap-row">
          <span className="fap-what"><strong>{b.branch}</strong><small>{b.assets} asset{b.assets === 1 ? "" : "s"} · {kyat(b.amount)} MMK</small></span>
          {b.run?.status === "POSTED" ? (
            b.run.docId ? <Link className="fa-jlink" href={`/documents/${b.run.docId}`}>{b.run.docNo}</Link> : <span className="fa-pill posted">Posted</span>
          ) : !canPost || mode === "MANUAL" ? (
            <span className="fa-pill ready">Ready</span>
          ) : b.run?.status === "DRAFT" ? (
            <span className="fap-go">
              <form action={discard}><input type="hidden" name="run_id" value={b.run.id} />
                <button className="ie-btn">Discard</button></form>
              <form action={postAction}><input type="hidden" name="run_id" value={b.run.id} />
                <button className="ie-btn primary" disabled={posting}><Play size={13} aria-hidden="true" /> {posting ? "Posting…" : "Post journal"}</button></form>
            </span>
          ) : (
            <form action={prepareAction}>
              <input type="hidden" name="branch_id" value={b.branchId} /><input type="hidden" name="month" value={month} />
              <button className="ie-btn primary" disabled={preparing}>{preparing ? "Preparing…" : "Review & post"}</button>
            </form>
          )}
        </div>
      ))}
    </div>
  );
}
