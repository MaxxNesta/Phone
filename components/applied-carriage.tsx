"use client";

import { useRef, useState } from "react";
import { CalendarDays, FileText, Hash, Layers, Truck, Wallet } from "lucide-react";
import { CarriagePreview } from "./courier-bill-form";
import { SPREAD, type Spread } from "./spread-field";
import type { AppliedCarriage as Applied } from "@/lib/courier-payables";

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
const day = (d: string) => new Date(d).toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
// Posted charges are spread equally or by cost; a fixed amount per item posts as equal.
const spreadLabel = (m: string) => (m in SPREAD ? SPREAD[m as Spread].label : m === "MANUAL" ? "Manual by product variant" : m);

/**
 * On a goods receipt or purchase bill: the carriage already applied to its
 * goods, opened in the same sheet Record carriage inward previews — whether
 * the charge came with the document or was recorded afterwards.
 */
export function AppliedCarriage({ charges }: { charges: Applied[] }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [i, setI] = useState(0);
  if (charges.length === 0) return null;
  const c = charges[Math.min(i, charges.length - 1)];
  const carriage = /carriage/i.test(c.costType);
  const open = (n: number) => { setI(n); ref.current?.showModal(); };

  return (
    <>
      {charges.map((x, n) => (
        <button key={x.id} type="button" className="btn ghost tiny" onClick={() => open(n)}>
          <Truck size={14} aria-hidden="true" /> {/carriage/i.test(x.costType) ? "Carriage inward" : x.costType} applied · {fmt(x.total)}
        </button>
      ))}
      <dialog ref={ref} className="cbp" aria-labelledby="cbp-title">
        <CarriagePreview
          key={c.id}
          applied={{ docNo: c.docNo }}
          shares={c.shares}
          title={carriage ? "Carriage inward applied" : `${c.costType} applied`}
          costLabel={carriage ? "Carriage" : c.costType}
          details={[
            { icon: CalendarDays, label: "Date", value: day(c.date) },
            { icon: Hash, label: "Amount", value: `${fmt(c.total)} MMK` },
            { icon: Wallet, label: "Payment", value: c.paidFrom ? `Paid now · ${c.paidFrom}` : `Pay later · owed${c.courier ? ` to ${c.courier}` : ""}` },
            { icon: Layers, label: "Spread", value: spreadLabel(c.method) },
            { icon: FileText, label: "Reference", value: c.reference || "—" },
          ]}
          note={c.note ?? ""}
          onBack={() => ref.current?.close()}
        />
      </dialog>
    </>
  );
}
