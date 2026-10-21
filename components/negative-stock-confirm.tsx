"use client";

import { useEffect, useRef } from "react";
import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";

export type Shortfall = {
  itemCode: string;
  itemName: string;
  uomCode: string;
  required: number;
  recorded: number;
};

const qty = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 4 });

/**
 * The question asked before stock is allowed to go negative.
 *
 * Not a warning that can be scrolled past. The ERP is about to record
 * something it has no evidence for — goods leaving that it never saw arrive —
 * and the only thing that makes that legitimate rather than a corrupted
 * balance is a person saying the stock is physically on the shelf. So the
 * question is asked plainly, in those words, and the answer is stored on the
 * document.
 *
 * Every figure is shown per item rather than summarised, because "insufficient
 * stock" across four lines is not a thing anyone can confirm; "Dress: 10
 * required, 0 recorded, −10 projected" is.
 */
export function NegativeStockConfirm({
  open, shortfalls, onCancel, onConfirm,
}: {
  open: boolean;
  shortfalls: Shortfall[];
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const t = useTranslations("inventory");
  const c = useTranslations("common");

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="confirm"
      onCancel={(e) => { e.preventDefault(); onCancel(); }}
      onClick={(e) => { if (e.target === ref.current) onCancel(); }}
    >
      <div className="confirm-panel">
        {/* The icon, not the emoji. An emoji is rendered by the operating
            system, so it changes shape between a Mac, a Windows PC and an
            Android phone, ignores the colour it is given, and sits on the
            baseline differently in each — none of which a warning that
            gates a stock movement should be subject to. */}
        <div className="confirm-icon" aria-hidden="true">
          <AlertTriangle size={19} strokeWidth={2.25} />
        </div>
        <h2 className="confirm-title">{t("neg.insufficientTitle")}</h2>
        <p className="confirm-detail">
          {t("neg.confirmBody", { which: shortfalls.length === 1 ? t("neg.thisItem") : t("neg.theseItems") })}
        </p>

        <div className="tablewrap" style={{ marginTop: "0.6rem" }}>
          <table>
            <thead>
              <tr>
                <th>{t("item")}</th>
                <th className="r">{t("neg.required")}</th>
                <th className="r">{t("neg.recordedStock")}</th>
                <th className="r">{t("neg.projected")}</th>
              </tr>
            </thead>
            <tbody>
              {shortfalls.map((s) => (
                <tr key={s.itemCode}>
                  <td className="wrap">
                    {s.itemName}
                    <div className="subline code">{s.itemCode}</div>
                  </td>
                  <td className="r">{qty(s.required)} {s.uomCode}</td>
                  <td className="r">{qty(s.recorded)} {s.uomCode}</td>
                  <td className="r" style={{ color: "var(--bad)" }}>
                    <strong>{qty(s.recorded - s.required)}</strong> {s.uomCode}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="confirm-detail" style={{ marginTop: "0.6rem" }}>
          {t("neg.confirmFoot")}
        </p>

        <div className="confirm-actions">
          <button type="button" className="ghost" onClick={onCancel}>{c("cancel")}</button>
          <button type="button" className="warn" onClick={onConfirm}>{t("neg.yesContinue")}</button>
        </div>
      </div>
    </dialog>
  );
}
