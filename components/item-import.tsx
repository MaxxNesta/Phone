"use client";

import { useActionState, useState, useTransition } from "react";
import { previewItemImport, itemImportTemplate, createMissingMasterData } from "@/lib/actions";
import { FileDrop, type Upload } from "./file-drop";
import type { ActionResult } from "@/lib/actions";
import { useTranslations } from "next-intl";

type Issue = { row: number; column?: string; message: string };
type Registrable = {
  kind: "brand" | "category" | "subcategory";
  name: string;
  parent?: string;
  similarTo?: string;
  rows: number[];
};
type PlannedRow = {
  row: number; barcode: string; name: string; itemId: string | null; isNew: boolean;
  serial: string; code: string; serialAssigned: boolean; salePrice: number | null;
  unitName: string; categoryName: string; subCategoryName: string | null;
  brandName: string | null;
};
type Plan = {
  rows: PlannedRow[];
  missing: Registrable[];
  errors: Issue[];
  warnings: Issue[];
  summary: { rows: number; newItems: number; existingItems: number };
};

const TEMPLATE_HEADER = "No,Barcode,Stock ID,Stock Name,Category,Sub Category,Brand,Unit,Selling price";
const TEMPLATE_EXAMPLE = [
  '1,8851234567890,Item001,Coca-Cola 300ml,Beverages,Soft Drinks,Coca-Cola,Bottle',
  '2,8851234567891,Item002,Sprite 300ml,Beverages,Soft Drinks,Sprite,Bottle',
  '3,10001,,T-Shirt Black L,Clothing,,,Piece',
].join("\n");

export function ItemImport({ action }: {
  action: (prev: unknown, fd: FormData) => Promise<ActionResult>;
}) {
  const t = useTranslations("itemImport");
  const c = useTranslations("common");
  const [state, formAction, posting] = useActionState<ActionResult | null, FormData>(action as never, null);
  const [csv, setCsv] = useState("");
  const [format, setFormat] = useState<"csv" | "xlsx">("csv");
  const [filename, setFilename] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [picked, setPicked] = useState(false);
  const [gettingTemplate, startTemplate] = useTransition();
  const [addingBrands, startBrands] = useTransition();
  const [pendingName, setPendingName] = useState<string | null>(null);
  const [checking, startChecking] = useTransition();

  function save(blob: Blob, name: string) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /** The Excel template, built on the server so the Barcode column can arrive
   *  already formatted as Text — which is what stops the barcode being
   *  mangled before the file ever gets back here. */
  function downloadTemplate() {
    startTemplate(async () => {
      setReadError(null);
      try {
        const { base64 } = await itemImportTemplate();
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        save(
          new Blob([bytes], {
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          }),
          "item-import-template.xlsx"
        );
      } catch (e) {
        setReadError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  function downloadCsvTemplate() {
    save(new Blob([`${TEMPLATE_HEADER}\n${TEMPLATE_EXAMPLE}\n`], { type: "text/csv;charset=utf-8" }),
         "item-import-template.csv");
  }

  function onPick(u: Upload) {
    setPlan(null);
    setReadError(null);
    setCsv(u.content);
    setFormat(u.format);
    setFilename(u.name);
    setPicked(true);
    startChecking(async () => {
      try {
        const res = await previewItemImport(u.content, u.name, u.format);
        setPlan(res.plan as unknown as Plan);
      } catch (e) {
        setReadError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  function recheck() {
    startChecking(async () => {
      try {
        const res = await previewItemImport(csv, filename, format);
        setPlan(res.plan as unknown as Plan);
      } catch (e) {
        setReadError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  function register(entries: Registrable[]) {
    setPendingName(entries.length === 1 ? entries[0].name : "*all*");
    startBrands(async () => {
      setReadError(null);
      const res = await createMissingMasterData(
        entries.map((e) => ({ kind: e.kind, name: e.name, parent: e.parent }))
      );
      setPendingName(null);
      if (!res.ok) { setReadError(res.error); return; }
      recheck();
    });
  }

  const blocked = !plan || plan.errors.length > 0 || plan.rows.length === 0;

  return (
    <>
      <section>
        <div className="card">
          <div className="card-head">
            <h2>{t("step1")}</h2>
            <span className="page-sub">{t("step1Sub")}</span>
          </div>
          <div className="card-body">
            <FileDrop
              onPick={onPick}
              onClear={() => { setPicked(false); setPlan(null); setCsv(""); setFilename(""); }}
              picked={picked ? filename : null}
              busy={checking}
            />

            <div className="row" style={{ alignItems: "flex-end", marginTop: "0.75rem" }}>
              <div className="actions">
                <button type="button" onClick={downloadTemplate} disabled={gettingTemplate}>
                  {gettingTemplate ? t("preparing") : t("downloadExcel")}
                </button>
                <button type="button" className="ghost" onClick={downloadCsvTemplate}>{t("csvInstead")}</button>
              </div>
            </div>

            <div className="alert" style={{ marginTop: "0.75rem" }}>
              <strong>{t("barcodeText")}</strong>{" "}
              {t("barcodeWhy")}{" "}
              {!picked
                ? t("barcodeTemplate")
                : format === "xlsx"
                  ? t("barcodeXlsx")
                  : t("barcodeCsv")}
            </div>

            {checking && <p className="page-sub">{t("checking")}</p>}
            {readError && <div className="alert">{readError}</div>}
          </div>
        </div>
      </section>

      {plan && (
        <section>
          <div className="card">
            <div className="card-head">
              <h2>{t("step2")}</h2>
              <span className="page-sub">{filename}</span>
            </div>

            <div className="kpis" style={{ margin: "0.75rem" }}>
              <div className="kpi">
                <span className="kpi-label">{t("newItems")}</span>
                <span className="kpi-value">{plan.summary.newItems}</span>
                <span className="kpi-note">{t("newNote")}</span>
              </div>
              <div className="kpi">
                <span className="kpi-label">{t("alreadyHere")}</span>
                <span className="kpi-value">{plan.summary.existingItems}</span>
                <span className="kpi-note">{t("alreadyNote")}</span>
              </div>
              <div className="kpi">
                <span className="kpi-label">{t("rowsRead")}</span>
                <span className="kpi-value">{plan.summary.rows}</span>
                <span className="kpi-note">{t("rowsNote")}</span>
              </div>
              <div className="kpi">
                <span className="kpi-label">{t("errors")}</span>
                <span className="kpi-value" style={{ color: plan.errors.length ? "var(--bad)" : undefined }}>
                  {plan.errors.length}
                </span>
              </div>
              <div className="kpi">
                <span className="kpi-label">{t("warnings")}</span>
                <span className="kpi-value" style={{ color: plan.warnings.length ? "var(--warn)" : undefined }}>
                  {plan.warnings.length}
                </span>
              </div>
            </div>

            {plan.missing.length > 0 && (
              <div className="card-body">
                <div className="alert">
                  <strong>
                    {t("missingTitle", { n: plan.missing.length })}
                  </strong>{" "}
                  {t("missingBody")}

                  <div style={{ margin: "0.75rem 0 0.5rem" }}>
                    {(["category", "subcategory", "brand"] as const).map((kind) => {
                      const group = plan.missing.filter((m) => m.kind === kind);
                      if (group.length === 0) return null;
                      const label =
                        kind === "category" ? t("kindCategory")
                        : kind === "subcategory" ? t("kindSub")
                        : t("kindBrand");
                      return (
                        <div key={kind} style={{ marginBottom: "0.6rem" }}>
                          <div className="page-sub" style={{ marginBottom: "0.25rem" }}>
                            {label} ({group.length})
                            {kind === "subcategory" && t("createdUnder")}
                          </div>
                          <div className="tablewrap">
                            <table>
                              <tbody>
                                {group.map((m) => (
                                  <tr key={`${m.kind}-${m.parent ?? ""}-${m.name}`}>
                                    <td className="wrap">
                                      <strong>{m.name}</strong>
                                      {m.parent && (
                                        <span style={{ color: "var(--muted)" }}>{t("underParent", { parent: m.parent })}</span>
                                      )}
                                      <div className="subline" style={{ color: "var(--muted)" }}>
                                        {m.rows.length === 1
                                          ? t("rowOne", { n: m.rows[0] })
                                          : t("rowsMany", { n: m.rows.length, list: `${m.rows.slice(0, 6).join(", ")}${m.rows.length > 6 ? "…" : ""}` })}
                                      </div>
                                    </td>
                                    <td className="wrap">
                                      {/* The case worth stopping on: a name a
                                          keystroke away from one already here
                                          is usually the same thing, and adding
                                          it makes two. */}
                                      {m.similarTo && (
                                        <span style={{ color: "var(--warn)" }}>
                                          {t("looksLike", { name: m.similarTo })}
                                        </span>
                                      )}
                                    </td>
                                    <td style={{ width: "1%", whiteSpace: "nowrap" }}>
                                      <button
                                        type="button"
                                        className={m.similarTo ? "ghost tiny" : "tiny"}
                                        onClick={() => register([m])}
                                        disabled={addingBrands || checking}
                                      >
                                        {addingBrands && pendingName === m.name ? t("adding") : t("add")}
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <button type="button" onClick={() => register(plan.missing)}
                          disabled={addingBrands || checking}>
                    {addingBrands && pendingName === "*all*"
                      ? t("adding")
                      : t("addAll", { n: plan.missing.length })}
                  </button>
                  <a href="/items/categories" className="btn ghost" style={{ marginLeft: "0.4rem" }}>
                    {t("manageCategories")}
                  </a>
                  <a href="/items/brands" className="btn ghost" style={{ marginLeft: "0.4rem" }}>
                    {t("manageBrands")}
                  </a>
                </div>
              </div>
            )}

            {plan.rows.length > 0 && (
              <>
                <div className="card-head" style={{ borderTop: "1px solid var(--line)" }}>
                  <h2 style={{ fontSize: "var(--t-md)" }}>{t("itemMaster")}</h2>
                  <span className="page-sub">
                    {t("itemMasterNote")} {t("codeNote")}
                  </span>
                </div>
                <div className="tablewrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{t("colRow")}</th><th>{t("colBarcode")}</th><th>{t("colStockId")}</th><th>{t("colCode")}</th>
                        <th>{t("colStockName")}</th><th>{t("colCategory")}</th><th>{t("colSub")}</th>
                        <th>{t("colBrand")}</th><th>{t("colUnit")}</th>
                        <th className="r">{t("colPrice")}</th><th />
                      </tr>
                    </thead>
                    <tbody>
                      {plan.rows.map((r) => (
                        <tr key={r.row}>
                          <td className="code">{r.row}</td>
                          <td className="code">{r.barcode || "—"}</td>
                          <td className="code">
                            {r.serial}
                            {r.serialAssigned && (
                              <div className="subline" style={{ color: "var(--muted)" }}>{t("assigned")}</div>
                            )}
                          </td>
                          <td className="code"><strong>{r.code}</strong></td>
                          <td className="wrap">{r.name}</td>
                          <td style={{ color: "var(--muted)" }}>{r.categoryName}</td>
                          <td style={{ color: "var(--muted)" }}>{r.subCategoryName ?? "—"}</td>
                          <td style={{ color: "var(--muted)" }}>{r.brandName ?? "—"}</td>
                          <td className="code">{r.unitName}</td>
                          {/* Shown because it is the one column that becomes
                              money later, and the preview is the last chance
                              to notice a price that reads wrong. */}
                          <td className="r">
                            {r.salePrice === null
                              ? <span style={{ color: "var(--muted)" }}>—</span>
                              : r.salePrice.toLocaleString("en-US")}
                          </td>
                          <td>
                            <span className={`pill ${r.isNew ? "" : "ok"}`}>
                              {r.isNew ? t("pillNew") : t("pillExisting")}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {plan.errors.length > 0 && (
              <div className="tablewrap">
                <table>
                  <thead>
                    <tr><th>{t("colRow")}</th><th>{t("colColumn")}</th><th>{t("mustFix")}</th></tr>
                  </thead>
                  <tbody>
                    {plan.errors.slice(0, 200).map((e, i) => (
                      <tr key={i}>
                        <td className="code">{e.row}</td>
                        <td className="code" style={{ color: "var(--muted)" }}>{e.column ?? "—"}</td>
                        <td className="wrap" style={{ color: "var(--bad)" }}>{e.message}</td>
                      </tr>
                    ))}
                    {plan.errors.length > 200 && (
                      <tr><td colSpan={3} className="empty">
                        {t("andMoreFix", { n: plan.errors.length - 200 })}
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {plan.warnings.length > 0 && (
              <div className="tablewrap">
                <table>
                  <thead>
                    <tr><th>{t("colRow")}</th><th>{t("colColumn")}</th><th>{t("worthLook")}</th></tr>
                  </thead>
                  <tbody>
                    {plan.warnings.slice(0, 50).map((w, i) => (
                      <tr key={i}>
                        <td className="code">{w.row}</td>
                        <td className="code" style={{ color: "var(--muted)" }}>{w.column ?? "—"}</td>
                        <td className="wrap" style={{ color: "var(--warn)" }}>{w.message}</td>
                      </tr>
                    ))}
                    {plan.warnings.length > 50 && (
                      <tr><td colSpan={3} className="empty">{t("andMore", { n: plan.warnings.length - 50 })}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      )}

      <section>
        <div className="card">
          <div className="card-head"><h2>{t("step3")}</h2></div>
          <form action={formAction} className="form">
            <input type="hidden" name="csv" value={csv} />
            <input type="hidden" name="format" value={format} />
            <input type="hidden" name="filename" value={filename} />
            <div className="card-body">
              {state && "error" in state && <div className="alert">{state.error}</div>}

              <p className="page-sub">
                {blocked
                  ? t("uploadFirst")
                  : t("creates", { n: plan!.summary.newItems }) +
                    (plan!.summary.existingItems > 0
                      ? t("leaving", { n: plan!.summary.existingItems })
                      : "") +
                    t("nothingPosted")}
              </p>
            </div>
            <div className="card-body" style={{ paddingTop: 0 }}>
              <button type="submit" disabled={blocked || posting || checking}>
                {posting ? t("importing") : t("confirmImport")}
              </button>
            </div>
          </form>
        </div>
      </section>
    </>
  );
}
