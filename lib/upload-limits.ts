/**
 * What an upload may be, checked on the server from the bytes themselves.
 *
 * A browser's file.type and a filename's extension are both the sender's
 * claim. The first bytes are not: a PDF starts %PDF, a PNG with its eight-byte
 * signature, and so on. A file is accepted only when what it says it is and
 * what it actually is agree.
 */

export const SPREADSHEET_MAX_BYTES = 5 * 1024 * 1024;
export const SPREADSHEET_MAX_ROWS = 20_000;

const starts = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);
const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));

/** The kind of file these bytes are, by signature, or null. */
export function sniff(b: Uint8Array): "pdf" | "jpeg" | "png" | "webp" | "heic" | "zip" | null {
  if (starts(b, [0x25, 0x50, 0x44, 0x46])) return "pdf";                        // %PDF
  if (starts(b, [0xff, 0xd8, 0xff])) return "jpeg";
  if (starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return "webp";
  if (ascii(b, 4, 8) === "ftyp" && /^(heic|heix|hevc|heim|heis|mif1|msf1)$/.test(ascii(b, 8, 12))) return "heic";
  if (starts(b, [0x50, 0x4b, 0x03, 0x04])) return "zip";                        // xlsx is a zip
  return null;
}

/** The signature each accepted attachment type must carry. */
export const ATTACHMENT_SNIFF: Record<string, ReturnType<typeof sniff>> = {
  "application/pdf": "pdf", "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp", "image/heic": "heic",
};

/**
 * A spreadsheet sent as text (CSV) or base64 (xlsx): refused if it is too big
 * to be a genuine import, or if an "xlsx" is not a workbook at all.
 */
export function checkSpreadsheet(content: string, format: string): void {
  if (format !== "csv" && format !== "xlsx") throw new Error("Upload a .xlsx or .csv file.");
  if (typeof content !== "string" || content.length === 0) throw new Error("The file is empty.");
  const bytes = format === "xlsx" ? Math.floor((content.length * 3) / 4) : Buffer.byteLength(content, "utf8");
  if (bytes > SPREADSHEET_MAX_BYTES) {
    throw new Error(`That file is ${(bytes / 1024 / 1024).toFixed(1)}MB; the limit is ${SPREADSHEET_MAX_BYTES / 1024 / 1024}MB. Split it into smaller files.`);
  }
  if (format === "xlsx" && sniff(Buffer.from(content.slice(0, 16), "base64")) !== "zip") {
    throw new Error("That is not an Excel workbook. Save it as .xlsx, or as CSV.");
  }
}

export function checkRowCount(rows: unknown[]): void {
  if (rows.length > SPREADSHEET_MAX_ROWS) {
    throw new Error(`That file has ${rows.length.toLocaleString("en-US")} rows; the limit is ${SPREADSHEET_MAX_ROWS.toLocaleString("en-US")}. Split it into smaller files.`);
  }
}
