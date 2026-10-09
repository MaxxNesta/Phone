"use client";

import { useState, type ComponentProps } from "react";
import { LayoutGrid } from "lucide-react";
import { ItemPicker } from "./item-picker";
import { PhonePicker, type VariantCatalog } from "./phone-picker";

/**
 * Two ways onto a line, side by side: type a code, SKU, barcode or name, or
 * browse — category, brand, model, then storage and colour — the way the
 * goods receipt picks. Without a catalogue it is the plain search.
 */
export function ItemChooser({ catalog, ...props }: ComponentProps<typeof ItemPicker> & { catalog?: VariantCatalog }) {
  const [browsing, setBrowsing] = useState(false);
  if (!catalog) return <ItemPicker {...props} />;
  return (
    <div className="ichoose">
      <div className="ichoose-row">
        <ItemPicker {...props} />
        <button type="button" className="btn ghost tiny" aria-expanded={browsing}
          onClick={() => setBrowsing((b) => !b)} title="Pick by category, brand and model">
          <LayoutGrid size={14} aria-hidden="true" /> Browse
        </button>
      </div>
      {browsing && (
        <PhonePicker catalog={catalog} value={props.value}
          onPick={(id) => { props.onPick(id); setBrowsing(false); }} />
      )}
    </div>
  );
}
