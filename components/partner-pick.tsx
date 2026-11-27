"use client";
import { useRef } from "react";
import { MultiFilter } from "@/components/data-table";

/**
 * Several customers or suppliers in a GET filter form (2026-11-27): the
 * invoice lists' searchable checklist, sent as one comma-joined field and
 * applied when the list closes.
 */
export function PartnerPick({ name, value, allLabel, label, partners }: {
  name: string; value: string; allLabel: string; label: string;
  partners: { id: string; code: string; name: string }[];
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={ref} type="hidden" name={name} defaultValue={value} />
      <MultiFilter
        filter={{ key: name, allLabel, label, multi: true, options: partners.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` })) }}
        value={value}
        onApply={(v) => { if (ref.current) { ref.current.value = v; ref.current.form?.requestSubmit(); } }}
      />
    </>
  );
}
