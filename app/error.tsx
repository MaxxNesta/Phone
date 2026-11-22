"use client";

/**
 * When a page or an action fails. A production build hides the message from
 * the browser, so a refusal that matters says so through its digest: a shop
 * the provider has set to read-only (lib/auth.ts requirePermission) is told
 * that plainly, not shown a bare "Application error".
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const readOnly = error.digest === "SHOP_READ_ONLY";
  return (
    <div className="card" role="alert" style={{ maxWidth: 640 }}>
      <div className="card-head"><h2>{readOnly ? "This shop is read-only" : "Something went wrong"}</h2></div>
      <div className="card-body">
        <p className="page-sub">
          {readOnly
            ? "Nothing can be posted or changed until the subscription is renewed. You can still look everything up. Contact your provider to renew."
            : "This could not be finished. Nothing was saved. Try again, and if it keeps happening, note the reference below."}
        </p>
        {!readOnly && error.digest && <p className="m" style={{ marginTop: "0.75rem" }}>Reference: {error.digest}</p>}
        <div style={{ display: "flex", gap: 8, marginTop: "1rem" }}>
          <button type="button" className="btn" onClick={() => (readOnly ? history.back() : reset())}>{readOnly ? "Go back" : "Try again"}</button>
        </div>
      </div>
    </div>
  );
}
