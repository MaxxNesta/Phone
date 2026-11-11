"use client";

import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

/** "Add category": puts one more category on the canvas, keeping the rest of the view. */
export function CategoryAdd({ options, current, baseQuery }: {
  options: { id: string; name: string; units: number }[]; current: string[]; baseQuery: string;
}) {
  const router = useRouter();
  const left = options.filter((o) => !current.includes(o.id));
  if (left.length === 0) return null;
  return (
    <label className="sc-add">
      <Plus size={14} aria-hidden="true" />
      <span className="sr-only">Add a category</span>
      <select value="" aria-label="Add a category" onChange={(e) => {
        if (!e.target.value) return;
        const sep = baseQuery.length > 1 ? "&" : "";
        router.replace(`${baseQuery}${sep}cats=${[...current, e.target.value].join(",")}`, { scroll: false });
      }}>
        <option value="">Add category</option>
        {left.map((o) => <option key={o.id} value={o.id}>{o.name}{o.units ? ` · ${o.units.toLocaleString("en-US")} units` : " · no movement"}</option>)}
      </select>
    </label>
  );
}
