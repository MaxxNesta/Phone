"use client";

import { useEffect, useRef } from "react";

/**
 * A figure that rolls up to its value once, when the page opens.
 *
 * Takes the finished text ("2.48M MMK", "7 units") and animates only its
 * first number, keeping the same decimals, so the server's formatting stays
 * the single source of the figure. The text is right from the first paint:
 * the roll is drawn over it, never instead of it, so a reader with scripts
 * off or "Reduce motion" on sees the value and nothing moves.
 */
export function CountUp({ text, ms = 700 }: { text: string; ms?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    const m = /-?[\d,]*\.?\d+/.exec(text);
    if (!el || !m) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const target = Number(m[0].replace(/,/g, ""));
    if (!Number.isFinite(target) || target === 0) return;
    const decimals = (m[0].split(".")[1] ?? "").length;
    const commas = m[0].includes(",");
    const head = text.slice(0, m.index), tail = text.slice(m.index + m[0].length);
    const fmt = (v: number) => commas
      ? v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
      : v.toFixed(decimals);
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      const e = 1 - Math.pow(1 - p, 3);
      el.textContent = head + fmt(target * e) + tail;
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); el.textContent = text; };
  }, [text, ms]);
  return <span ref={ref}>{text}</span>;
}
