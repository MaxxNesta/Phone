// CI's dependency gate: fails on any high or critical advisory except those
// accepted below, each with why and until when. An expired acceptance fails
// again, so an exception cannot outlive the reason for it.
//
//   npm audit --json > audit.json; node scripts/audit-gate.mjs audit.json

import { readFileSync } from "node:fs";

const ACCEPTED = {
  // picomatch ReDoS: every version, no fix published as of 2026-11-18.
  // Reached only through next-intl → @parcel/watcher, matching our own file
  // globs; no user input ever becomes a pattern. Accepted by the owner
  // 2026-11-18 until the date below; re-check then.
  "GHSA-fc5q-39xc-vjpf": "2026-12-31",
};

const audit = JSON.parse(readFileSync(process.argv[2] ?? "audit.json", "utf8"));
const today = new Date().toISOString().slice(0, 10);
const live = (id) => ACCEPTED[id] && ACCEPTED[id] >= today;
const blocking = [];
for (const [name, v] of Object.entries(audit.vulnerabilities ?? {})) {
  if (!["high", "critical"].includes(v.severity)) continue;
  // An advisory sits on the package itself (an object in `via`); a package
  // that is only flagged for depending on one (a string) follows that one.
  const own = (v.via ?? []).filter((x) => typeof x === "object");
  const open = own.filter((x) => ["high", "critical"].includes(x.severity) && !live(x.url?.split("/").pop()));
  if (open.length) blocking.push(`${name}: ${open.map((x) => x.url).join(", ")}`);
}
for (const [id, until] of Object.entries(ACCEPTED)) {
  if (until < today) console.log(`Acceptance of ${id} expired on ${until}: it blocks again until reviewed.`);
}
if (blocking.length) {
  console.error("High or critical advisories:\n  " + blocking.join("\n  "));
  process.exit(1);
}
console.log("Audit gate: no high or critical advisories beyond the accepted ones.");
