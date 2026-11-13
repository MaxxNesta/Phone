"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Search, Clock } from "lucide-react";
import { DISPLAY_TZ } from "@/lib/format";

/**
 * The top bar's left slot: the global search everywhere, and on the counter
 * sale a live date and time instead. The till has its own scan bar, and a
 * cashier needs the clock (for the slip, the shift) more than a second search.
 */
export function TopSearch({ placeholder, label }: { placeholder: string; label: string }) {
  const onTill = usePathname()?.startsWith("/pos") ?? false;
  if (onTill) return <TillClock />;
  return (
    <form action="/search" className="topsearch" role="search">
      <Search size={15} aria-hidden="true" />
      <input name="q" placeholder={placeholder} aria-label={label} />
    </form>
  );
}

function TillClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  // Nothing until the browser has the time, so the server and the first paint never disagree.
  if (!now) return <div className="tillclock" aria-hidden="true" />;
  const day = now.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: DISPLAY_TZ });
  const time = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: DISPLAY_TZ });
  return (
    <div className="tillclock" role="timer" aria-live="off" aria-label={`${day} ${time}`}>
      <Clock size={15} aria-hidden="true" />
      <span className="tillclock-day">{day}</span>
      <span className="tillclock-time">{time}</span>
    </div>
  );
}
