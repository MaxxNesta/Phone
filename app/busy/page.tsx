import { AlertTriangle } from "lucide-react";
import { BusyActions } from "@/components/busy-actions";

/** Where a report or a download lands when it has been asked for too often (lib/heavy.ts). */
export default async function Busy({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const { m } = await searchParams;
  return (
    <div className="busy-scrim">
      <div className="busy-card" role="alertdialog" aria-labelledby="busy-title" aria-describedby="busy-text">
        <span className="notice-icon busy-icon" aria-hidden="true"><AlertTriangle size={22} strokeWidth={2.2} /></span>
        <h2 id="busy-title">Please wait a moment</h2>
        <p id="busy-text">{m ?? "This was asked for too often. Wait a moment and try again."}</p>
        <BusyActions />
      </div>
    </div>
  );
}
