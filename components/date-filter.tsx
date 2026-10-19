"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DATE_PRESETS, type DatePreset, type DateRange } from "@/lib/date-range";
import { useTranslations } from "next-intl";

export { dateWindow, inDateRange, ANY_DATE, type DatePreset, type DateRange } from "@/lib/date-range";

/** The preset menu, and two day fields when the range is custom. */
export function DateFilter({ value, onChange }: { value: DateRange; onChange: (v: DateRange) => void }) {
  const d = useTranslations("dates");
  return (
    <div className="dt-dates" role="group" aria-label={d("label")}>
      <select
        aria-label={d("label")}
        className={`dt-filter${value.preset ? " dt-filter-on" : ""}`}
        value={value.preset}
        onChange={(e) => onChange({ ...value, preset: e.target.value as DatePreset })}
      >
        {DATE_PRESETS.map(([v]) => <option key={v} value={v}>{d(`preset.${v || "any"}`)}</option>)}
      </select>
      {value.preset === "custom" && (
        <>
          <input type="date" className="dt-date" aria-label={d("from")} value={value.from}
            max={value.to || undefined} onChange={(e) => onChange({ ...value, from: e.target.value })} />
          <span className="dt-date-sep" aria-hidden="true">–</span>
          <input type="date" className="dt-date" aria-label={d("to")} value={value.to}
            min={value.from || undefined} onChange={(e) => onChange({ ...value, to: e.target.value })} />
        </>
      )}
    </div>
  );
}

/**
 * The same menu for a page whose figures are worked out on the server: the
 * range lives in the URL (?date=, ?from=, ?to=), so it survives a reload and
 * can be shared, and the page re-reads it. Other parameters are kept.
 */
export function UrlDateFilter() {
  const router = useRouter(), path = usePathname(), sp = useSearchParams();
  const value: DateRange = {
    preset: (sp.get("date") ?? "") as DatePreset, from: sp.get("from") ?? "", to: sp.get("to") ?? "",
  };
  const onChange = (v: DateRange) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, x] of [["date", v.preset], ["from", v.preset === "custom" ? v.from : ""], ["to", v.preset === "custom" ? v.to : ""]] as const) {
      if (x) next.set(k, x); else next.delete(k);
    }
    const q = next.toString();
    router.replace(q ? `${path}?${q}` : path, { scroll: false });
  };
  return <DateFilter value={value} onChange={onChange} />;
}
