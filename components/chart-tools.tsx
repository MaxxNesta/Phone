"use client";

import { useEffect, useRef, useState } from "react";
import { Download, FileSpreadsheet, Maximize2, Minimize2 } from "lucide-react";

/**
 * Expand and export for a chart card, as icons only: full screen, a PNG of
 * the card as it looks, and its figures as CSV. Placed in the card's head;
 * it acts on the card it sits in, so no chart needs to know about it.
 */
export function ChartTools({ name, rows }: {
  /** The file name, without extension. */
  name: string;
  /** Header row first; omit to offer the picture only. */
  rows?: (string | number)[][];
}) {
  const me = useRef<HTMLSpanElement>(null);
  const [full, setFull] = useState(false);
  const card = () => me.current?.closest(".card") as HTMLElement | null;

  useEffect(() => {
    const on = () => setFull(!!document.fullscreenElement && document.fullscreenElement === card());
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);

  const save = (blob: Blob, file: string) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = file; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const csv = () => {
    if (!rows) return;
    const q = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    save(new Blob(["﻿" + rows.map((r) => r.map(q).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }), `${name}.csv`);
  };

  /** The card drawn as it is: every element's computed style copied inline, then rendered through an SVG. */
  const png = () => {
    const src = card();
    if (!src) return;
    const clone = src.cloneNode(true) as HTMLElement;
    const a = [src, ...src.querySelectorAll("*")] as HTMLElement[];
    const b = [clone, ...clone.querySelectorAll("*")] as HTMLElement[];
    a.forEach((el, i) => {
      const cs = getComputedStyle(el);
      let css = "";
      for (let k = 0; k < cs.length; k++) css += `${cs[k]}:${cs.getPropertyValue(cs[k])};`;
      b[i].setAttribute("style", css);
    });
    clone.querySelector(".chart-tools")?.remove();
    const w = src.offsetWidth, h = src.offsetHeight;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><foreignObject width="100%" height="100%">`
      + `<div xmlns="http://www.w3.org/1999/xhtml">${new XMLSerializer().serializeToString(clone)}</div></foreignObject></svg>`;
    const img = new Image();
    img.onload = () => {
      const k = 2, c = document.createElement("canvas");
      c.width = w * k; c.height = h * k;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = getComputedStyle(src).backgroundColor || "#fff";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.scale(k, k); ctx.drawImage(img, 0, 0);
      c.toBlob((blob) => blob && save(blob, `${name}.png`), "image/png");
    };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  };

  const expand = () => {
    const c = card();
    if (!c) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else c.requestFullscreen?.();
  };

  return (
    <span className="chart-tools" ref={me}>
      <button type="button" className="chart-tool" onClick={png} title="Download as image" aria-label="Download as image">
        <Download size={15} aria-hidden="true" />
      </button>
      {rows && (
        <button type="button" className="chart-tool" onClick={csv} title="Download as CSV" aria-label="Download as CSV">
          <FileSpreadsheet size={15} aria-hidden="true" />
        </button>
      )}
      <button type="button" className="chart-tool" onClick={expand}
              title={full ? "Exit full screen" : "Expand"} aria-label={full ? "Exit full screen" : "Expand"}>
        {full ? <Minimize2 size={15} aria-hidden="true" /> : <Maximize2 size={15} aria-hidden="true" />}
      </button>
    </span>
  );
}
