/**
 * IMEI and IMEISV (2026-11-24). The IMEI is 15 digits: model code, serial and
 * a Luhn check digit. The IMEISV some phones also show is 16: the same first
 * 14 digits and a 2-digit software version. A scanned IMEISV is the same
 * phone, so a lookup tries the number as scanned and then the IMEI behind it.
 */

export function imeiCheckOk(v: string) {
  if (!/^\d{15}$/.test(v)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let d = Number(v[14 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

/** The IMEI a 16-digit IMEISV stands for; null for anything else. */
export function imeiFromImeisv(v: string) {
  const s = v.trim();
  if (!/^\d{16}$/.test(s)) return null;
  const body = s.slice(0, 14);
  for (let d = 0; d <= 9; d++) if (imeiCheckOk(body + d)) return body + d;
  return null;
}

/** What to look a scanned value up by: itself, and the IMEI behind it when it is an IMEISV. */
export function lookupKeys(v: string): string[] {
  const s = v.trim();
  const imei = imeiFromImeisv(s);
  return imei ? [s, imei] : [s];
}
