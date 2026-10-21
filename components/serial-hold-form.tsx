import { setSerialHold } from "@/lib/phone-actions";
import { getTranslations } from "next-intl/server";

export async function SerialHoldForm({ serialId, held }: { serialId: string; held: string | null }) {
  const t = await getTranslations("inventory");
  const c = await getTranslations("common");
  const kind = held ? (t.has(`dev.holdKind.${held}`) ? t(`dev.holdKind.${held}`) : held.toLowerCase()) : "";
  return (
    <form action={setSerialHold} className="card">
      <div className="card-head"><h2>{held ? t("hold.held", { kind }) : t("hold.holdThis")}</h2></div>
      <div className="card-body filter-row">
        <input type="hidden" name="serial_id" value={serialId} />
        <div className="field">
          <label htmlFor="hold-note">{c("note")}</label>
          <input id="hold-note" name="note" placeholder={held ? t("hold.whyReleased") : t("hold.notePlaceholder")} />
        </div>
        {held ? (
          <button className="btn" name="kind" value="RELEASE">{t("hold.release")}</button>
        ) : (
          <>
            <button className="btn" name="kind" value="RESERVED">{t("hold.reserve")}</button>
            <button className="btn ghost" name="kind" value="REPAIR">{t("hold.sendRepair")}</button>
          </>
        )}
      </div>
    </form>
  );
}
