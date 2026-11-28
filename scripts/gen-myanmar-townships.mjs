// Myanmar's townships from MIMU, two outputs from one source (2026-11-27):
//   lib/mm-townships/<region>.json — each region's township map, loaded only when clicked
//   db/migrations/0239_a_customer_is_placed_from_a_list.sql — the place list customers choose from
//   lib/mm-places.json — the same list for the picker, loaded when it opens
//
//   node scripts/gen-myanmar-townships.mjs <mmr_admin3.geojson> <mmr_admin_boundaries.json>
//   (the .json is MIMU's mmr_admin_boundaries.xlsx, each sheet as an array of rows by header)
//
// Source: Myanmar Information Management Unit (MIMU), administrative boundaries
// and P-codes, via HDX cod-ab-mmr (CC BY-IGO; credited on the map). One source
// for the map and the list, so a customer's township is always a shape.
// MIMU splits Shan and Bago into parts; here they are one state and one region,
// as the app's fifteen are. Cocokyun (the Coco Islands, Yangon's) is listed but
// not drawn: drawn, it would shrink the city to a speck.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const [geo, xl] = process.argv.slice(2).map((f) => JSON.parse(readFileSync(f, "utf8")));
const BOX = 460, TOL = 0.7, MIN_AREA = 1.5;
const region = (s) => s.replace(/ \((East|West|North|South)\)$/, "");
const regionMy = (s) => s.replace(/ \(.+\)$/, "");
const keyOf = (s) => s.toLowerCase().replace(/[^a-z]/g, "");

// Cities of several townships. A township in one carries the city; one not
// surely in a city (the owner, 2026-11-27) is a township only.
const CITY = {
  Mandalay: { my: "မန္တလေး", code: "C-MDY", region: "Mandalay", towns: ["Amarapura", "Aungmyaythazan", "Chanayethazan", "Chanmyathazi", "Mahaaungmyay", "Patheingyi", "Pyigyitagon"] },
  Yangon: { my: "ရန်ကုန်", code: "C-YGN", region: "Yangon", towns: ["Ahlone", "Bahan", "Botahtaung", "Dagon", "Dagon Myothit (East)", "Dagon Myothit (North)", "Dagon Myothit (Seikkan)", "Dagon Myothit (South)", "Dala", "Dawbon", "Hlaing", "Hlaingtharya (East)", "Hlaingtharya (West)", "Insein", "Kamaryut", "Kyauktada", "Kyeemyindaing", "Lanmadaw", "Latha", "Mayangone", "Mingaladon", "Mingalartaungnyunt", "North Okkalapa", "Pabedan", "Pazundaung", "Sanchaung", "Seikgyikanaungto", "Shwepyithar", "South Okkalapa", "Tamwe", "Thaketa", "Thingangyun", "Yankin"] },
  "Nay Pyi Taw": { my: "နေပြည်တော်", code: "C-NPT", region: "Nay Pyi Taw", towns: ["Det Khi Na Thi Ri", "Oke Ta Ra Thi Ri", "Poke Ba Thi Ri", "Za Bu Thi Ri", "Zay Yar Thi Ri"] },
};
const CITY_DOT = { Mandalay: [96.0836, 21.9747], Yangon: [96.1735, 16.8409], "Nay Pyi Taw": [96.1297, 19.7633] };
// Spellings and places customers have typed, checked with the owner (2026-11-27).
const ALSO = {
  Taunggyi: ["Taungyi"], Loilen: ["Loilem"], Mogoke: ["Mogok"], Mohnyin: ["Monghnyin"], Yinmarbin: ["Yinmabin"],
  Minbya: ["Min Pyar"], Ayadaw: ["Ayartaw"], "Nyaung-U": ["Bagan"], Kalaw: ["Aung Pann", "Aungban"], Myittha: ["Kume"],
  Taze: ["Kaduma", "Kanhtuma"], Pyinoolwin: ["Pyin Oo Lwin", "Maymyo"], Mawlamyine: ["Moulmein"], Pathein: ["Bassein"],
  "Hpa-An": ["Pa-an"], Myitkyina: ["Myit Kyina"],
};

// ------------------------------------------------------------ the list --
const a3 = xl.mmr_admin3;
const towns = new Map();                 // township pcode → towns in it, from MIMU's towns (level 5's parents)
for (const r of xl.mmr_admin5) {
  if (!r.adm4_name || !/Town$/.test(r.adm4_name)) continue;
  const t = r.adm4_name.replace(/ ?Town$/, "").trim();
  if (!t) continue;
  const set = towns.get(r.adm3_pcode) ?? new Set(); set.add(t); towns.set(r.adm3_pcode, set);
}
const q = (s) => (s == null ? "null" : `'${String(s).replace(/'/g, "''")}'`);
const arr = (xs) => `array[${xs.map(q).join(",")}]::text[]`;
const cityOf = (name, reg) => Object.entries(CITY).find(([, c]) => c.region === reg && c.towns.includes(name))?.[0] ?? null;
const regions = new Map(xl.mmr_admin1.map((r) => [region(r.adm1_name), regionMy(r.adm1_name1)]));
for (const [c, v] of Object.entries(CITY)) for (const t of v.towns) if (!a3.some((r) => r.adm3_name === t && region(r.adm1_name) === v.region)) throw new Error(`${c}: no township ${t}`);
for (const t of Object.keys(ALSO)) if (!a3.some((r) => r.adm3_name === t)) throw new Error(`ALSO: no township ${t}`);

const rows = [
  ...[...regions].map(([name, my]) => `(${q("R-" + keyOf(name))},'REGION',${q(name)},${q(my)},${q(name)},null,null,${arr([keyOf(name)])})`),
  ...Object.entries(CITY).map(([name, c]) => `(${q(c.code)},'CITY',${q(name)},${q(c.my)},${q(c.region)},${q(name)},null,${arr([keyOf(name), ...(name === "Nay Pyi Taw" ? ["naypyidaw"] : [])])})`),
  ...a3.map((r) => {
    const reg = region(r.adm1_name);
    const keys = [...new Set([keyOf(r.adm3_name), ...(ALSO[r.adm3_name] ?? []).map(keyOf), ...[...(towns.get(r.adm3_pcode) ?? [])].map(keyOf)])].filter(Boolean);
    return `(${q(r.adm3_pcode)},'TOWNSHIP',${q(r.adm3_name)},${q(r.adm3_name1)},${q(reg)},${q(cityOf(r.adm3_name, reg))},${q(r.adm2_name)},${arr(keys)})`;
  }),
];

const sqlText = `-- A customer is placed from a list (2026-11-27).
--
-- Township was free text, and free text spelled one place five ways, put a
-- town where a township belongs and Pakokku in Mandalay. Now a customer points
-- at one place from MIMU's official list: a township, a city of several
-- townships (Mandalay, Yangon, Nay Pyi Taw) when the township is not known,
-- or just a region. Region, city and township on the customer are filled from
-- it, so every page that already reads them keeps working; what was typed
-- before stays in township_typed until the owner has checked the result.
--
-- Source: Myanmar Information Management Unit (MIMU), administrative
-- boundaries and P-codes, via HDX cod-ab-mmr (CC BY-IGO). Generated by
-- scripts/gen-myanmar-townships.mjs; townships keep their MIMU P-code as code.
-- Shared by every company, like currency: a township is not a company's.

create table if not exists mm_place (
  code     text primary key,
  kind     text not null check (kind in ('REGION', 'CITY', 'TOWNSHIP')),
  name     text not null,
  name_my  text,
  region   text not null,
  -- The city of several townships this is, or lies in.
  city     text,
  district text,
  -- What finds it besides its name: older spellings, the towns inside it. Lower-case letters only.
  keys     text[] not null default '{}'
);

insert into mm_place (code, kind, name, name_my, region, city, district, keys) values
${rows.join(",\n")}
on conflict (code) do nothing;

alter table business_partner add column if not exists place_code text references mm_place(code);
alter table business_partner add column if not exists city text;
alter table business_partner add column if not exists township_typed text;
create index if not exists business_partner_place_idx on business_partner (company_id, place_code) where place_code is not null;

create or replace function fn_place_key(s text) returns text language sql immutable as
  $$ select lower(regexp_replace(coalesce(s, ''), '[^A-Za-z]', '', 'g')) $$;

-- What was typed, kept.
update business_partner set township_typed = township where township is not null and township_typed is null;

-- Each customer's place: the township or city its text names (its own region's
-- first), else its region, else nothing — "not sure yet".
update business_partner p set place_code = coalesce(
  (select pl.code from mm_place pl
    where pl.kind in ('TOWNSHIP', 'CITY') and p.township is not null
      and fn_place_key(p.township) <> ''
      and (fn_place_key(pl.name) = fn_place_key(p.township) or fn_place_key(p.township) = any(pl.keys))
    order by (pl.region = p.region) desc, (pl.kind = 'CITY') desc, (fn_place_key(pl.name) = fn_place_key(p.township)) desc, pl.code
    limit 1),
  (select pl.code from mm_place pl where pl.kind = 'REGION' and pl.region = p.region))
 where p.place_code is null and (p.township is not null or p.region is not null);

-- Region, city and township as the place says. A city alone is its own
-- township line, as "Mandalay" always was; a region alone has none.
update business_partner p set
       region = pl.region,
       city = pl.city,
       township = case when pl.kind = 'REGION' then null else pl.name end
  from mm_place pl
 where pl.code = p.place_code;
`;
writeFileSync(new URL("../db/migrations/0239_a_customer_is_placed_from_a_list.sql", import.meta.url), sqlText);
// The same list for the place picker, loaded by the browser only when the picker opens.
const places = [
  ...[...regions].map(([name, my]) => ({ c: "R-" + keyOf(name), k: "R", n: name, m: my, r: name, t: null, s: [keyOf(name)] })),
  ...Object.entries(CITY).map(([name, c]) => ({ c: c.code, k: "C", n: name, m: c.my, r: c.region, t: name, s: [keyOf(name), ...(name === "Nay Pyi Taw" ? ["naypyidaw"] : [])] })),
  ...a3.map((r) => {
    const reg = region(r.adm1_name);
    return { c: r.adm3_pcode, k: "T", n: r.adm3_name, m: r.adm3_name1, r: reg, t: cityOf(r.adm3_name, reg),
      s: [...new Set([keyOf(r.adm3_name), ...(ALSO[r.adm3_name] ?? []).map(keyOf), ...[...(towns.get(r.adm3_pcode) ?? [])].map(keyOf)])].filter(Boolean) };
  }),
];
writeFileSync(new URL("../lib/mm-places.json", import.meta.url), JSON.stringify(places));
console.log(`migration: ${rows.length} places (${regions.size} regions, ${Object.keys(CITY).length} cities, ${a3.length} townships), ${(sqlText.length / 1024).toFixed(0)} KB`);

// ------------------------------------------------------------- the maps --
const polys = (g) => (g.type === "Polygon" ? [g.coordinates] : g.coordinates);
const ringArea = (p) => p.reduce((s, [x, y], i) => { const [x2, y2] = p[(i + 1) % p.length]; return s + x * y2 - x2 * y; }, 0) / 2;
const centroid = (r) => { let a = 0, cx = 0, cy = 0; r.forEach(([x, y], i) => { const [x2, y2] = r[(i + 1) % r.length]; const k = x * y2 - x2 * y; a += k; cx += (x + x2) * k; cy += (y + y2) * k; });
  return [cx / (3 * a), cy / (3 * a)]; };
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
const feats = geo.features.filter((f) => f.properties.adm3_name !== "Cocokyun")
  .map((f) => ({ name: f.properties.adm3_name, code: f.properties.adm3_pcode, region: region(f.properties.adm1_name), ps: polys(f.geometry) }));

mkdirSync(new URL("../lib/mm-townships/", import.meta.url), { recursive: true });
let totalKb = 0;
for (const reg of [...new Set(feats.map((t) => t.region))].sort()) {
  const mine = feats.filter((t) => t.region === reg);
  const pts = mine.flatMap((t) => t.ps.flat(2));
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const k = Math.cos(((minY + maxY) / 2) * Math.PI / 180);
  const s = BOX / Math.max((maxX - minX) * k, maxY - minY);
  const W = Math.ceil((maxX - minX) * k * s), H = Math.ceil((maxY - minY) * s);
  const proj = ([x, y]) => [(x - minX) * k * s, (maxY - y) * s];
  const out = mine.map((t) => {
    let parts = t.ps.map((p) => p.map((r) => simplify(r.map(proj)))).filter((p) => Math.abs(ringArea(p[0])) >= MIN_AREA);
    if (!parts.length) parts = [t.ps.map((p) => p.map((r) => r.map(proj))).sort((a, b) => Math.abs(ringArea(b[0])) - Math.abs(ringArea(a[0])))[0]];
    const d = parts.map((p) => p.filter((r) => r.length >= 3).map((r) => "M" + r.map(([x, y]) => `${r1(x)},${r1(y)}`).join("L") + "Z").join("")).join("");
    const main = parts.map((p) => p[0]).sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)))[0];
    const [cx, cy] = centroid(main);
    return { name: t.name, code: t.code, d, cx: r1(cx), cy: r1(cy) };
  }).sort((a, b) => a.name.localeCompare(b.name));
  const dots = Object.entries(CITY_DOT).filter(([c]) => CITY[c].region === reg)
    .map(([name, ll]) => { const [x, y] = proj(ll); return { name, x: r1(x), y: r1(y) }; });
  const json = JSON.stringify({ region: reg, view: { w: W, h: H }, townships: out, dots });
  writeFileSync(new URL(`../lib/mm-townships/${keyOf(reg)}.json`, import.meta.url), json);
  totalKb += json.length / 1024;
  console.log(`${reg.padEnd(12)} ${String(out.length).padStart(3)} townships  ${(json.length / 1024).toFixed(1)} KB`);
}
console.log(`maps: ${totalKb.toFixed(0)} KB over ${new Set(feats.map((t) => t.region)).size} files`);
