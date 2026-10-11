// k6 load test for the phone ERP — runs against DEV data only (see setup.mjs).
//
//   k6 run -e BASE=http://localhost:3300 -e PROFILE=smoke loadtest/erp.js
//   k6 run -e BASE=http://localhost:3300 -e PROFILE=ramp  loadtest/erp.js
//
// Workflows use the app's real routes and its server actions (the same POST
// the browser makes: Next-Action header + encoded arguments). Each virtual
// user carries its own session cookie for its own test account.

import http from "k6/http";
import { check, sleep, group } from "k6";
import exec from "k6/execution";
import { Counter, Trend, Rate } from "k6/metrics";
import { SharedArray } from "k6/data";

const BASE = __ENV.BASE || "http://localhost:3300";
const PROFILE = __ENV.PROFILE || "smoke";
const RUN = JSON.parse(open("./run.json"));
// Action ids differ per build: the local build's, or the deployed one's.
const ACT = JSON.parse(open(__ENV.ACTIONS || "./actions.json"));
// Vercel's deployment-protection cookie, when testing the deployed app.
const VJWT = __ENV.VJWT || "";
const IMEIS = new SharedArray("imeis", () => RUN.imeis);

// ---- metrics ---------------------------------------------------------------
const bizRejected = new Counter("biz_rejected");        // expected refusals (race loser, etc.)
const sysFailed = new Counter("sys_failed");            // anything unexpected
const sysFailRate = new Rate("sys_fail_rate");
const timeouts = new Counter("timeouts");
const posted = new Counter("docs_posted");
const raceWon = new Counter("race_won");
const raceLost = new Counter("race_lost");
const stepTime = {
  browse: new Trend("t_browse", true), report: new Trend("t_report", true),
  sale: new Trend("t_sale", true), receipt: new Trend("t_receipt", true),
  payment: new Trend("t_payment", true), dashboard: new Trend("t_dashboard", true),
};

const ramp = {
  executor: "ramping-vus", startVUs: 0, gracefulRampDown: "30s",
  stages: [
    { duration: "20s", target: 5 }, { duration: "3m", target: 5 },
    { duration: "20s", target: 10 }, { duration: "3m", target: 10 },
    { duration: "20s", target: 20 }, { duration: "3m", target: 20 },
    { duration: "30s", target: 50 }, { duration: "3m", target: 50 },
  ],
};
// Soak: the same mix held at SOAK_VUS (15) for SOAK_DURATION (3h), with a
// same-IMEI race every five minutes throughout.
const soak = {
  work: { executor: "constant-vus", vus: Number(__ENV.SOAK_VUS || 15), duration: __ENV.SOAK_DURATION || "3h" },
  race: { executor: "per-vu-iterations", vus: 2, iterations: 30, exec: "race", startTime: "1m",
          maxDuration: __ENV.SOAK_DURATION || "3h" },
};
// fifty: 50 users held for 3 minutes. spike: 20 users, then 50 in ten seconds, then back.
const fifty = { executor: "ramping-vus", startVUs: 0, gracefulRampDown: "30s",
  stages: [{ duration: "30s", target: 50 }, { duration: "3m", target: 50 }] };
const spike = { executor: "ramping-vus", startVUs: 0, gracefulRampDown: "30s",
  stages: [{ duration: "20s", target: 20 }, { duration: "1m", target: 20 }, { duration: "10s", target: 50 },
           { duration: "2m", target: 50 }, { duration: "10s", target: 20 }, { duration: "1m", target: 20 }] };
const short = (work) => ({ work,
  race: { executor: "per-vu-iterations", vus: 2, iterations: 8, exec: "race", startTime: "40s", maxDuration: "4m" } });
export const options = {
  scenarios: PROFILE === "soak" ? soak : PROFILE === "fifty" ? short(fifty) : PROFILE === "spike" ? short(spike)
    : PROFILE === "smoke"
    ? { work: { executor: "per-vu-iterations", vus: 1, iterations: 6, maxDuration: "5m" },
        race: { executor: "per-vu-iterations", vus: 2, iterations: 3, exec: "race", startTime: "5s", maxDuration: "3m" } }
    : { work: ramp,
        race: { executor: "per-vu-iterations", vus: 2, iterations: 17, exec: "race", startTime: "1m", maxDuration: "12m" } },
  // Stop on sustained system failure or severe slowdown, not on business refusals.
  thresholds: {
    sys_fail_rate: [{ threshold: "rate<0.10", abortOnFail: true, delayAbortEval: "60s" }],
    "http_req_duration{kind:page}": [{ threshold: "p(95)<20000", abortOnFail: true, delayAbortEval: "60s" }],
  },
  summaryTrendStats: ["count", "avg", "med", "p(90)", "p(95)", "max"],
  noCookiesReset: true,
};

// ---- plumbing --------------------------------------------------------------
const token = () => RUN.users[(exec.vu.idInTest - 1) % RUN.users.length];
const cookie = () => ({ Cookie: `erp_session=${token()}${VJWT ? `; _vercel_jwt=${VJWT}` : ""}` });

function outcome(res, name) {
  if (res.error_code === 1050 || res.timings.duration >= 59000) { timeouts.add(1, { name }); }
}

function page(path, step, name) {
  const res = http.get(`${BASE}${path}`, { headers: cookie(), tags: { name, kind: "page" }, timeout: "60s", redirects: 0 });
  outcome(res, name);
  const ok = res.status === 200;
  sysFailRate.add(!ok, { name });
  if (!ok) { sysFailed.add(1, { name }); console.warn(`${name} ${res.status} ${String(res.body).slice(0, 120)}`); }
  stepTime[step].add(res.timings.duration, { name });
  return res;
}

/** A server action called the way the browser calls it. */
function action(path, id, body, contentType, name) {
  const res = http.post(`${BASE}${path}`, body, {
    headers: { ...cookie(), "Next-Action": id, Accept: "text/x-component",
               "Content-Type": contentType, Origin: BASE },
    tags: { name, kind: "action" }, timeout: "60s", redirects: 0,
  });
  outcome(res, name);
  return res;
}

/** A form action: (prevState, formData) encoded as React does — fields under "_1_", root ["$undefined","$K1"]. */
function formAction(path, id, fields, name) {
  // Multipart, written by hand: fields first and the root ("0") last, as React
  // writes them — the server reads the body as a stream and resolves the root
  // the moment it arrives — and k6 does not keep the order of an object's fields.
  const B = "----lt" + Math.random().toString(36).slice(2);
  const CRLF = "\r\n";
  const part = (k, v) => "--" + B + CRLF + 'Content-Disposition: form-data; name="' + k + '"' + CRLF + CRLF + v + CRLF;
  const body = Object.entries(fields).map(([k, v]) => part("_1_" + k, String(v))).join("")
    + part("0", JSON.stringify(["$undefined", "$K1"])) + "--" + B + "--" + CRLF;
  return action(path, id, body, `multipart/form-data; boundary=${B}`, name);
}

const uid = () => `${RUN.run}-${exec.vu.idInTest}-${exec.vu.iterationInScenario}-${Math.random().toString(36).slice(2, 8)}`;

// What came back from a POS sale: {"ok":true,...} or {"ok":false,"error":"..."}.
function posResult(res) {
  const m = String(res.body).match(/"ok":(true|false)(?:,"id":"([^"]+)")?(?:,"error":"([^"]*)")?/);
  return m ? { ok: m[1] === "true", id: m[2], error: m[3] } : null;
}

// ---- workflows -------------------------------------------------------------
function browse() {
  group("browse", () => {
    page(`/products?q=${encodeURIComponent(["iPhone", "case", "128", "Pro"][Math.floor(Math.random() * 4)])}`, "browse", "products search");
    sleep(1 + Math.random() * 2);
    page("/inventory", "browse", "inventory summary");
    sleep(1 + Math.random() * 2);
    page("/inventory/phones", "browse", "IMEI tracking");
    sleep(1);
    page("/items/stock", "browse", "stock");
  });
}

function reports() {
  group("reports", () => {
    page("/", "dashboard", "dashboard");
    sleep(2 + Math.random() * 3);
    const r = ["/finance/income-statement", "/finance/balance-sheet", "/finance/cash-flow",
               "/sales/reports?by=pivot", "/reports/price-history?side=sale", "/finance/cash-flow?method=indirect"];
    page(r[Math.floor(Math.random() * r.length)], "report", "financial report");
  });
}

/** A counter sale: cases always, and a phone by IMEI half the time. */
function cashSale() {
  group("cash sale", () => {
    page("/pos", "browse", "pos page");
    sleep(2 + Math.random() * 3);
    const lines = [{ itemId: RUN.caseId, qty: 1 + Math.floor(Math.random() * 3), unitPrice: 15000, discountPct: 0,
                     taxCodeId: null, serials: [], warrantyMonths: null }];
    let total = lines[0].qty * 15000;
    if (Math.random() < 0.5) {
      const imei = IMEIS[exec.scenario.iterationInTest % IMEIS.length];
      lines.push({ itemId: RUN.phoneId, qty: 1, unitPrice: 2500000, discountPct: 0, taxCodeId: null, serials: [imei], warrantyMonths: 12 });
      total += 2500000;
    }
    const sale = { locationId: RUN.warehouseId, partnerId: null, salesmanId: null, priceIncludesTax: false,
                   memo: `LOADTEST ${RUN.run}`, lines, payments: [{ accountId: RUN.cashAccountId, amount: total }], attempt: uid() };
    const res = action("/pos", ACT.posPostSale, JSON.stringify([sale]), "text/plain;charset=UTF-8", "post sale");
    stepTime.sale.add(res.timings.duration);
    const r = posResult(res);
    if (r?.ok) posted.add(1, { doc: "sale" });
    else classify(r?.error, res, "post sale");
  });
}

/** Sold on account, then paid: a sales invoice and a customer receipt against it. */
function creditSaleAndPayment() {
  group("credit sale + payment", () => {
    const qty = 2 + Math.floor(Math.random() * 3);
    const sale = { locationId: RUN.warehouseId, partnerId: RUN.customerId, salesmanId: null, priceIncludesTax: false,
                   memo: `LOADTEST ${RUN.run} credit`, payments: [], attempt: uid(),
                   lines: [{ itemId: RUN.caseId, qty, unitPrice: 15000, discountPct: 0, taxCodeId: null, serials: [], warrantyMonths: null }] };
    const res = action("/pos", ACT.posPostSale, JSON.stringify([sale]), "text/plain;charset=UTF-8", "post credit sale");
    stepTime.sale.add(res.timings.duration);
    const r = posResult(res);
    if (!r?.ok) return classify(r?.error, res, "post credit sale");
    posted.add(1, { doc: "sale" });
    sleep(3 + Math.random() * 4);
    page(`/receivables/receive?partner=${RUN.customerId}`, "browse", "receive payment page");
    const pay = formAction("/receivables/receive", ACT.createCustomerReceipt, {
      partner_id: RUN.customerId, doc_date: RUN.today, cash_account_id: RUN.cashAccountId,
      location_id: RUN.warehouseId, memo: `LOADTEST ${RUN.run}`, idempotency_key: uid(),
      allocations: JSON.stringify([{ invoiceId: r.id, amount: qty * 15000 }]),
    }, "post receipt");
    stepTime.payment.add(pay.timings.duration);
    if (redirectedToDoc(pay)) posted.add(1, { doc: "receipt" });
    else classify(errorOf(pay), pay, "post receipt");
  });
}

function goodsReceipt() {
  group("goods receipt", () => {
    page("/purchases/receive/new", "browse", "GR page");
    sleep(3 + Math.random() * 4);
    const res = formAction("/purchases/receive/new", ACT.createGoodsReceipt, {
      partner_id: RUN.supplierId, location_id: RUN.warehouseId, doc_date: RUN.today,
      memo: `LOADTEST ${RUN.run}`, reference: uid(), idempotency_key: uid(),
      lines: JSON.stringify([{ itemId: RUN.caseId, qty: 10 + Math.floor(Math.random() * 40), unitCost: 5000 }]),
    }, "post goods receipt");
    stepTime.receipt.add(res.timings.duration);
    if (redirectedToDoc(res)) posted.add(1, { doc: "gr" });
    else classify(errorOf(res), res, "post goods receipt");
  });
}

const redirectedToDoc = (res) => /\/documents\//.test(res.headers["X-Action-Redirect"] || "");
const errorOf = (res) => (String(res.body).match(/"error":"([^"]*)"/) || [])[1];

/** A refusal the business rules are meant to give is not a system failure. */
const EXPECTED = /already sold|is sold|is not in stock|not out with|SOLD|reserved/i;
function classify(error, res, name) {
  if (error && EXPECTED.test(error)) { bizRejected.add(1, { name }); sysFailRate.add(false, { name }); return; }
  sysFailed.add(1, { name }); sysFailRate.add(true, { name });
  console.warn(`${name}: HTTP ${res.status} ${error ?? String(res.body).slice(0, 200)}`);
}

export default function () {
  // ONLY=<workflow> runs just that one — for checking a workflow end to end.
  const only = { browse, reports, cashSale, creditSaleAndPayment, goodsReceipt }[__ENV.ONLY];
  if (only) { only(); return; }
  const r = Math.random();
  if (r < 0.30) browse();
  else if (r < 0.50) reports();
  else if (r < 0.78) cashSale();
  else if (r < 0.90) creditSaleAndPayment();
  else goodsReceipt();
  sleep(3 + Math.random() * 5);
}

/**
 * Two users, the same IMEI, the same moment. Both wait for the next 4-second
 * mark on the wall clock, then post; exactly one may succeed.
 */
export function race() {
  const i = exec.vu.iterationInScenario;
  // Smoke takes the first race phones, the ramp the ones after, so the two never share one.
  const imei = RUN.raceImeis[i + Number(__ENV.RACE_OFFSET ?? (PROFILE === "smoke" ? 0 : 5))];
  if (!imei) return;
  const wait = 4000 - (Date.now() % 4000);
  sleep(wait / 1000);
  const sale = { locationId: RUN.warehouseId, partnerId: null, salesmanId: null, priceIncludesTax: false,
                 memo: `LOADTEST ${RUN.run} race ${i}`, attempt: uid(),
                 lines: [{ itemId: RUN.phoneId, qty: 1, unitPrice: 2500000, discountPct: 0, taxCodeId: null, serials: [imei], warrantyMonths: 12 }],
                 payments: [{ accountId: RUN.cashAccountId, amount: 2500000 }] };
  const res = action("/pos", ACT.posPostSale, JSON.stringify([sale]), "text/plain;charset=UTF-8", "race sale");
  const r = posResult(res);
  if (r?.ok) { raceWon.add(1); posted.add(1, { doc: "sale" }); }
  else if (r && !r.ok) { raceLost.add(1); bizRejected.add(1, { name: "race sale" }); console.log(`race ${i} refused: ${r.error}`); }
  else { sysFailed.add(1, { name: "race sale" }); console.warn(`race ${i}: HTTP ${res.status} ${String(res.body).slice(0, 200)}`); }
  sleep(PROFILE === "soak" ? 300 : 6);
}
