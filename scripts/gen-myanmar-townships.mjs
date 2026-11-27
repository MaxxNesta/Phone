// Myanmar's townships, one small file per state or region, for the sales map's
// click-to-zoom (2026-11-27).
//
//   node scripts/gen-myanmar-townships.mjs <adm3.geojson> <adm1.geojson>
//     → lib/mm-townships/<region>.json
//
// Townships: geoBoundaries gbOpen MMR ADM3 (Myanmar Analytics Project, 2019),
// CC BY 4.0 — https://www.geoboundaries.org (simplified geometry). Regions, to
// say which township is in which: Natural Earth admin-1 (public domain), the
// same file gen-myanmar-map.mjs reads. Natural Earth keeps Nay Pyi Taw inside
// Mandalay, so its eight townships are named here. A file is fetched only when
// its region is clicked; the page never loads all 330.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const [adm3, adm1] = process.argv.slice(2).map((f) => JSON.parse(readFileSync(f, "utf8")));
const BOX = 460, TOL = 0.7, MIN_AREA = 1.5;
const NPT = new Set(["Det Khi Na Thi Ri", "Oke Ta Ra Thi Ri", "Poke Ba Thi Ri", "Za Bu Thi Ri", "Zay Yar Thi Ri", "Pyinmana", "Lewe", "Tatkon"]);
const REGION = { "Rakhine State": "Rakhine", "Chin State": "Chin", "Kachin State": "Kachin", "Shan State": "Shan",
  "Kayah State": "Kayah", "Kayin State": "Kayin", "Mon State": "Mon" };
// Cities that span several townships: a dot, not a shape.
const CITIES = [["Mandalay", 96.0836, 21.9747], ["Yangon", 96.1735, 16.8409], ["Nay Pyi Taw", 96.1297, 19.7633]];
const keyOf = (s) => s.toLowerCase().replace(/[^a-z]/g, "");

const polys = (g) => (g.type === "Polygon" ? [g.coordinates] : g.coordinates);
const ringArea = (p) => p.reduce((s, [x, y], i) => { const [x2, y2] = p[(i + 1) % p.length]; return s + x * y2 - x2 * y; }, 0) / 2;
const inRing = ([x, y], r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
  const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
const centroid = (r) => { let a = 0, cx = 0, cy = 0; r.forEach(([x, y], i) => { const [x2, y2] = r[(i + 1) % r.length]; const k = x * y2 - x2 * y; a += k; cx += (x + x2) * k; cy += (y + y2) * k; });
  return [cx / (3 * a), cy / (3 * a)]; };
const regions = adm1.features.map((f) => ({ name: REGION[f.properties.name_en] ?? f.properties.name_en, polys: polys(f.geometry) }));
const regionAt = (pt) => regions.find((r) => r.polys.some((p) => inRing(pt, p[0])))?.name;

// Each township's region: where its largest part's centre falls.
// Cocokyun (the Coco Islands) is Yangon's, far out in the Andaman Sea: drawn
// there it would shrink the city to a speck. No shop is on it; left out.
const towns = adm3.features.filter((f) => f.properties.shapeName !== "Cocokyun").map((f) => {
  const ps = polys(f.geometry);
  const main = ps.map((p) => p[0]).sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)))[0];
  const c = centroid(main);
  const name = f.properties.shapeName;
  return { name, ps, region: NPT.has(name) ? "Nay Pyi Taw" : regionAt(c) ?? regionAt(main[0]) };
});
const lost = towns.filter((t) => !t.region);
if (lost.length) throw new Error("No region for: " + lost.map((t) => t.name).join(", "));

function simplify(ring) {
  if (ring.length < 4) return ring;
  let m = 1, far = 0;
  ring.forEach(([x, y], i) => { const d = Math.hypot(x - ring[0][0], y - ring[0][1]); if (d > far) { far = d; m = i; } });
  return [...dp(ring.slice(0, m + 1)).slice(0, -1), ...dp(ring.slice(m))];
}
function dp(pts) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); let far = 0, at = -1;
    const [x1, y1] = pts[a], [x2, y2] = pts[b], dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
    for (let i = a + 1; i < b; i++) { const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + x2 * y1 - y2 * x1) / len; if (d > far) { far = d; at = i; } }
    if (far > TOL) { keep[at] = 1; stack.push([a, at], [at, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const r1 = (n) => Math.round(n * 10) / 10;

mkdirSync(new URL("../lib/mm-townships/", import.meta.url), { recursive: true });
let totalKb = 0;
for (const region of [...new Set(towns.map((t) => t.region))].sort()) {
  const mine = towns.filter((t) => t.region === region);
  const pts = mine.flatMap((t) => t.ps.flat(2));
  const [minX, maxX, minY, maxY] = [Math.min(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[1]))];
  const k = Math.cos(((minY + maxY) / 2) * Math.PI / 180);
  const s = BOX / Math.max((maxX - minX) * k, maxY - minY);
  const W = Math.ceil((maxX - minX) * k * s), H = Math.ceil((maxY - minY) * s);
  const proj = ([x, y]) => [(x - minX) * k * s, (maxY - y) * s];
  const out = mine.map((t) => {
    const parts = t.ps.map((p) => p.map((r) => simplify(r.map(proj)))).filter((p) => Math.abs(ringArea(p[0])) >= MIN_AREA);
    const use = parts.length ? parts : [t.ps.map((p) => p.map((r) => r.map(proj)))[0]].flat(0);
    const d = use.map((p) => p.filter((r) => r.length >= 3).map((r) => "M" + r.map(([x, y]) => `${r1(x)},${r1(y)}`).join("L") + "Z").join("")).join("");
    const main = use.map((p) => p[0]).sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)))[0];
    const [cx, cy] = centroid(main);
    return { name: t.name, d, cx: r1(cx), cy: r1(cy) };
  }).sort((a, b) => a.name.localeCompare(b.name));
  const dots = CITIES.filter(([, x, y]) => regionAt([x, y]) === region || (region === "Nay Pyi Taw" && y > 19.5 && y < 20.2 && x > 95.9 && x < 96.5))
    .filter(([n]) => !(region === "Mandalay" && n === "Nay Pyi Taw"))
    .map(([name, x, y]) => { const [px, py] = proj([x, y]); return { name, x: r1(px), y: r1(py) }; });
  const json = JSON.stringify({ region, view: { w: W, h: H }, townships: out, dots });
  writeFileSync(new URL(`../lib/mm-townships/${keyOf(region)}.json`, import.meta.url), json);
  totalKb += json.length / 1024;
  console.log(`${region.padEnd(12)} ${String(out.length).padStart(3)} townships  ${(json.length / 1024).toFixed(1)} KB  dots: ${dots.map((d) => d.name).join(", ") || "—"}`);
}
console.log(`total ${totalKb.toFixed(0)} KB over ${new Set(towns.map((t) => t.region)).size} files; each loads only when its region is clicked`);
