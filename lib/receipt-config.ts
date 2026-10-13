/**
 * What a receipt template can decide, and only that.
 *
 * Pure: no database, no React, so the server can sanitize with it and the
 * browser can preview with it. A template never carries markup — every text
 * field is plain text, drawn by React (which escapes it), with line breaks
 * kept — so nothing a template holds can run as code on a receipt.
 *
 * Some things are not a template's to hide: the receipt number, the date, the
 * items sold, the grand total, any tax actually charged, and that a sale was
 * voided. They always print, so a receipt never disagrees with the books.
 */

export type Paper = "58" | "80" | "A4";
export const PAPERS: Paper[] = ["58", "80", "A4"];
export const PAPER_LABEL: Record<Paper, string> = { "58": "58 mm", "80": "80 mm", A4: "A4" };

export type ReceiptConfig = {
  general: {
    /** Open the Sale complete sheet with the receipt after a sale. */
    showAfterSale: boolean;
    /** Ask the browser to print as soon as the sheet opens. */
    autoPrint: boolean;
    showPrintButton: boolean;
    /** Whether cashiers may print a receipt again from the sale later. */
    allowReprint: boolean;
    /** Offer Save as PDF (the browser's own print-to-PDF). */
    allowPdf: boolean;
    /** What the printer can actually print across, in mm: printers differ. */
    printableWidthMm: number;
    language: "en";
  };
  identity: {
    showLogo: boolean;
    /** Printed instead of the company name when set. */
    displayName: string;
    showBranchName: boolean;
    showAddress: boolean;
    showPhone: boolean;
    extraContact: string;
  };
  transaction: {
    showCashier: boolean;
    showSalesman: boolean;
    showCustomer: boolean;
    showPaymentMethod: boolean;
    showPaymentBreakdown: boolean;
    showSubtotal: boolean;
    showDiscounts: boolean;
    /** Hides the tax line only when no tax was charged. */
    showTaxWhenZero: boolean;
  };
  product: {
    showVariant: boolean;
    showQuantity: boolean;
    showUnitPrice: boolean;
    showDiscount: boolean;
    showLineTotal: boolean;
    showImei: boolean;
    imeiMode: "full" | "masked";
  };
  warranty: {
    show: boolean;
    showPeriod: boolean;
    showDates: boolean;
    policyText: string;
  };
  custom: {
    headerText: string;
    thankYou: string;
    returnPolicy: string;
    footerText: string;
  };
  style: {
    fontSize: "small" | "normal" | "large";
    headerAlign: "left" | "center";
    lineStyle: "dashed" | "solid";
    density: "compact" | "normal";
  };
};

/** Printable width each thermal paper usually has, and the range allowed. */
export const WIDTH: Record<"58" | "80", { def: number; min: number; max: number }> = {
  "58": { def: 48, min: 40, max: 58 },
  "80": { def: 72, min: 60, max: 80 },
};

/** The receipt the till has always printed. */
export function defaultConfig(paper: Paper = "80"): ReceiptConfig {
  return {
    general: {
      showAfterSale: true, autoPrint: false, showPrintButton: true, allowReprint: true, allowPdf: true,
      printableWidthMm: paper === "A4" ? 0 : WIDTH[paper].def, language: "en",
    },
    identity: {
      showLogo: true, displayName: "", showBranchName: true, showAddress: true, showPhone: true, extraContact: "",
    },
    transaction: {
      showCashier: true, showSalesman: true, showCustomer: true, showPaymentMethod: true,
      showPaymentBreakdown: true, showSubtotal: true, showDiscounts: true, showTaxWhenZero: true,
    },
    product: {
      showVariant: true, showQuantity: true, showUnitPrice: paper === "A4", showDiscount: true,
      showLineTotal: true, showImei: true, imeiMode: "full",
    },
    warranty: { show: true, showPeriod: true, showDates: false, policyText: "" },
    custom: { headerText: "", thankYou: "Thank you for your purchase.", returnPolicy: "", footerText: "" },
    style: { fontSize: "normal", headerAlign: "center", lineStyle: "dashed", density: "normal" },
  };
}

const LIMIT = {
  displayName: 80, extraContact: 160, policyText: 600,
  headerText: 300, thankYou: 200, returnPolicy: 500, footerText: 300,
} as const;

/** Plain text: control characters out (line breaks kept), trimmed, capped. */
export function cleanText(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "")
    .replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
}

const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
const pick = <T extends string>(v: unknown, allowed: readonly T[], d: T): T =>
  (allowed as readonly unknown[]).includes(v) ? (v as T) : d;

/**
 * Any object in, a valid config out: unknown keys dropped, every value checked
 * against its type, text cleaned and capped. What is stored and what is
 * drawn always passes through here.
 */
export function sanitizeConfig(input: unknown, paper: Paper): ReceiptConfig {
  const d = defaultConfig(paper);
  const i = (input && typeof input === "object" ? input : {}) as Record<string, Record<string, unknown>>;
  const g = i.general ?? {}, id = i.identity ?? {}, t = i.transaction ?? {}, p = i.product ?? {};
  const w = i.warranty ?? {}, c = i.custom ?? {}, s = i.style ?? {};
  let width = Number(g.printableWidthMm);
  if (paper === "A4") width = 0;
  else if (!Number.isFinite(width)) width = WIDTH[paper].def;
  else width = Math.min(WIDTH[paper].max, Math.max(WIDTH[paper].min, Math.round(width)));
  return {
    general: {
      showAfterSale: bool(g.showAfterSale, d.general.showAfterSale),
      autoPrint: bool(g.autoPrint, d.general.autoPrint),
      showPrintButton: bool(g.showPrintButton, d.general.showPrintButton),
      allowReprint: bool(g.allowReprint, d.general.allowReprint),
      allowPdf: bool(g.allowPdf, d.general.allowPdf),
      printableWidthMm: width,
      language: "en",
    },
    identity: {
      showLogo: bool(id.showLogo, d.identity.showLogo),
      displayName: cleanText(id.displayName, LIMIT.displayName),
      showBranchName: bool(id.showBranchName, d.identity.showBranchName),
      showAddress: bool(id.showAddress, d.identity.showAddress),
      showPhone: bool(id.showPhone, d.identity.showPhone),
      extraContact: cleanText(id.extraContact, LIMIT.extraContact),
    },
    transaction: {
      showCashier: bool(t.showCashier, d.transaction.showCashier),
      showSalesman: bool(t.showSalesman, d.transaction.showSalesman),
      showCustomer: bool(t.showCustomer, d.transaction.showCustomer),
      showPaymentMethod: bool(t.showPaymentMethod, d.transaction.showPaymentMethod),
      showPaymentBreakdown: bool(t.showPaymentBreakdown, d.transaction.showPaymentBreakdown),
      showSubtotal: bool(t.showSubtotal, d.transaction.showSubtotal),
      showDiscounts: bool(t.showDiscounts, d.transaction.showDiscounts),
      showTaxWhenZero: bool(t.showTaxWhenZero, d.transaction.showTaxWhenZero),
    },
    product: {
      showVariant: bool(p.showVariant, d.product.showVariant),
      showQuantity: bool(p.showQuantity, d.product.showQuantity),
      showUnitPrice: bool(p.showUnitPrice, d.product.showUnitPrice),
      showDiscount: bool(p.showDiscount, d.product.showDiscount),
      showLineTotal: bool(p.showLineTotal, d.product.showLineTotal),
      showImei: bool(p.showImei, d.product.showImei),
      imeiMode: pick(p.imeiMode, ["full", "masked"] as const, d.product.imeiMode),
    },
    warranty: {
      show: bool(w.show, d.warranty.show),
      showPeriod: bool(w.showPeriod, d.warranty.showPeriod),
      showDates: bool(w.showDates, d.warranty.showDates),
      policyText: cleanText(w.policyText, LIMIT.policyText),
    },
    custom: {
      headerText: cleanText(c.headerText, LIMIT.headerText),
      thankYou: cleanText(c.thankYou, LIMIT.thankYou),
      returnPolicy: cleanText(c.returnPolicy, LIMIT.returnPolicy),
      footerText: cleanText(c.footerText, LIMIT.footerText),
    },
    style: {
      fontSize: pick(s.fontSize, ["small", "normal", "large"] as const, d.style.fontSize),
      headerAlign: pick(s.headerAlign, ["left", "center"] as const, d.style.headerAlign),
      lineStyle: pick(s.lineStyle, ["dashed", "solid"] as const, d.style.lineStyle),
      density: pick(s.density, ["compact", "normal"] as const, d.style.density),
    },
  };
}

export const TEXT_LIMITS = LIMIT;

/** An IMEI shown as 3534•••••018: enough to match the box, not to copy it. */
export function maskImei(v: string): string {
  const s = v.trim();
  if (s.length <= 7) return s;
  return `${s.slice(0, 4)}${"•".repeat(Math.max(3, s.length - 7))}${s.slice(-3)}`;
}

// ------------------------------------------------------------ the data --

/** A posted sale as a receipt draws it. Read from the sale; never edited. */
export type ReceiptData = {
  docNo: string; version: number; status: string;
  date: string; time: string | null;
  customer: string | null; salesman: string | null; cashier: string | null;
  /** Cash, QR, Card, Split payment, Credit — what the customer was told. */
  paymentMethod: string;
  net: number; tax: number; total: number;
  subtotal: number; discount: number; freeCount: number; freeValue: number;
  lines: Array<{
    lineNo: number; productName: string; itemName: string; variant: string | null;
    qty: number; unitPrice: number; discountPct: number; amount: number;
    imeis: string[]; warrantyMonths: number | null; warrantyEnd: string | null;
    freeReason: string | null;
  }>;
  paid: Array<{ name: string; amount: number }>;
  onAccount: number;
};

/** Who sold it: as it stood when the sale was first printed. */
export type ReceiptIdentity = {
  companyName: string; branchName: string | null; address: string | null; phone: string | null;
  hasLogo: boolean;
};

/** Labelled as sample wherever it is shown: it is not a sale. */
export const SAMPLE_RECEIPT: ReceiptData = {
  docNo: "SAMPLE-0001", version: 1, status: "POSTED",
  date: new Date().toISOString().slice(0, 10), time: "16:28",
  customer: "Walk-in customer", salesman: "Ko Aung", cashier: "Ma Su", paymentMethod: "Split payment",
  subtotal: 8_290_000, discount: 156_000, freeCount: 1, freeValue: 15_000,
  net: 8_134_000, tax: 0, total: 8_134_000,
  lines: [
    { lineNo: 1, productName: "iPhone 17 Pro Max", itemName: "iPhone 17 Pro Max 512 GB / Cosmic Orange",
      variant: "512 GB · Cosmic Orange", qty: 2, unitPrice: 3_900_000, discountPct: 2, amount: 7_644_000,
      imeis: ["356938035643809", "356938035643817"], warrantyMonths: 12, warrantyEnd: null, freeReason: null },
    { lineNo: 2, productName: "USB-C to USB-C braided charging cable, 2 metre, fast charge 60 W",
      itemName: "USB-C to USB-C braided charging cable, 2 metre, fast charge 60 W", variant: null,
      qty: 2, unitPrice: 245_000, discountPct: 0, amount: 490_000,
      imeis: [], warrantyMonths: null, warrantyEnd: null, freeReason: null },
    { lineNo: 3, productName: "Clear case", itemName: "Clear case", variant: null,
      qty: 1, unitPrice: 0, discountPct: 0, amount: 0,
      imeis: [], warrantyMonths: null, warrantyEnd: null, freeReason: "Promotion" },
  ],
  paid: [{ name: "Cash on Hand", amount: 5_000_000 }, { name: "KBZPay", amount: 3_134_000 }],
  onAccount: 0,
};

export const SAMPLE_IDENTITY: ReceiptIdentity = {
  companyName: "Your shop", branchName: "Main branch", address: "No. 1, Example Street, Yangon",
  phone: "09 000 000 000", hasLogo: false,
};
