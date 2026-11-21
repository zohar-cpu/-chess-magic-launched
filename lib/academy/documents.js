// Agreement document generation (server side only).
// Source of truth: templates/source/License Agreement - usa.docx → scripts/build_templates.py →
// templates/*.docx + templates/manifest.json (SHA-256 of source and of each template).
// A template whose hash does not match the manifest is refused (no silent edits).
// Documents are DRAFTS (watermarked, signatures disabled) until manifest.approved === true.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { quote, offerWindow, usd, int, DISCOUNT_PCT } from "./pricing.js";
import { pilotPeriod } from "./pilot-lifecycle.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const TPL = path.join(ROOT, "templates");
export const TYPES = { pilot: "pilot-order-form", annual: "annual-license-order-form" };
const TBD = "[To be provided]";
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const fmtDay = (ymd) => (ymd ? new Date(ymd + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }) : null);
const v = (x) => (x === undefined || x === null || String(x).trim() === "" ? TBD : String(x).trim());

export function manifest() { return JSON.parse(fs.readFileSync(path.join(TPL, "manifest.json"), "utf8")); }

export function loadTemplate(type) {
  const m = manifest(); const name = TYPES[type];
  if (!name) throw new Error(`Unknown document type "${type}".`);
  const buf = fs.readFileSync(path.join(TPL, `${name}.docx`));
  if (sha256(buf) !== m.templates[name].sha256) throw new Error(`Template ${name} does not match its approved manifest hash. Rebuild with scripts/build_templates.py.`);
  return { buf, manifest: m, name };
}

const BAND_NOTE = (b) => (b.from === 1 ? "Applies to the first 500 licenses" : `Applies only to licenses ${int(b.from)}–${int(b.to)}`);

/** Annual License Order Form data. All prices are recomputed here from lib/pricing.js. */
export function annualData(c, { docId, version, draft, now = new Date() } = {}) {
  const win = offerWindow(now, c.campaignLaunchDate);
  const discount = c.applyLaunchDiscount !== undefined ? !!c.applyLaunchDiscount : win.status === "active";
  const q = quote(c.licenses, { discount });
  if (q.status !== "ok") throw new Error(`Licenses ${c.licenses}: ${q.status === "custom" ? "custom-quote policy applies (outside 50–100,000); no automatic Order Form." : "invalid quantity."}`);
  const end = c.licenseStart ? (() => { const d = new Date(c.licenseStart + "T12:00:00Z"); d.setUTCFullYear(d.getUTCFullYear() + 1); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); })() : null;
  return {
    draft, template_version: manifest().template_version, doc_id: docId, doc_version: String(version),
    quote_reference: v(c.reference), order_date: c.orderDate ? fmtDay(c.orderDate) : "[Date of last signature]",
    customer_name: v(c.legalName || c.orgName), customer_type: v(c.orgType), customer_state: v(c.state),
    registration_no: v(c.registrationNo), customer_address: v(c.address), contact_name: v(c.fullName), contact_title: v(c.jobTitle),
    contact_email: v(c.email), contact_phone: v(c.phone),
    bands: q.bands.map((b) => ({ band_label: b.from === 1 ? "First 500" : `${int(b.from)}–${int(b.to)}`, band_count: int(b.count),
      band_std_unit: usd(b.standardUnitCents), band_discount: discount ? `${DISCOUNT_PCT}% (first year only)` : "None",
      band_fy_unit: usd(b.firstYearUnitCents), band_note: `${BAND_NOTE(b)} · First-year subtotal ${usd(b.firstYearCents)}` })),
    licenses: int(q.licenses), std_total: usd(q.standardTotalCents), fy_total: usd(q.firstYearTotalCents), renewal_total: usd(q.renewalAnnualCents),
    discount_label: discount ? `${DISCOUNT_PCT}% (first year only)` : "None",
    discount_line: discount ? `${usd(q.savingsCents)} (${DISCOUNT_PCT}% of the standard fees for each tier, first License Term only)` : "None (standard pricing)",
    avg_fy_unit: usd(q.avgFirstYearCents), avg_std_unit: usd(q.avgStandardCents),
    taxes: v(c.taxes || "To be determined; the Customer will provide any tax-exemption certificate"),
    total_payable: `${usd(q.firstYearTotalCents)} plus applicable taxes, if any`,
    license_start: c.licenseStart ? fmtDay(c.licenseStart) : TBD, license_end: end ? fmtDay(end) : TBD,
    payment_terms: v(c.paymentTerms),
    renewal_line: `Not automatic. Any renewal is subject to Section 3.2 of the License Terms. Renewal pricing: the standard annual rates then in effect; at current standard rates, ${usd(q.renewalAnnualCents)} per year for ${int(q.licenses)} licenses. The first-year promotional discount does not apply to any renewal.`,
    offer_line: discount ? (win.endsDate ? `${DISCOUNT_PCT}% launch offer for orders requested on or before ${fmtDay(win.endsDate)}` : `${DISCOUNT_PCT}% launch offer [launch window dates to be set]`) : "Not applicable",
    dpa_listed: !!c.dpaListed,
    _quote: q,
  };
}

/** Pilot Order Form data. Total cost is always $0; the 30 days start on the Activation Date only. */
export function pilotData(c, { docId, version, draft } = {}) {
  const n = Number(c.pilotStudents);
  if (!Number.isInteger(n) || n < 1 || n > 100000) throw new Error("Pilot student quantity must be 1–100,000.");
  return {
    draft, template_version: manifest().template_version, doc_id: docId, doc_version: String(version),
    pilot_reference: v(c.reference), order_date: c.orderDate ? fmtDay(c.orderDate) : "[Date of last signature]",
    customer_name: v(c.legalName || c.orgName), registration_no: v(c.registrationNo), customer_address: v(c.address),
    contact_name: v(c.fullName), contact_title: v(c.jobTitle), contact_email: v(c.email), contact_phone: v(c.phone),
    pilot_students: int(n), pilot_teachers: c.pilotTeachers ? int(c.pilotTeachers) : false,
    _period: c.activationDate ? pilotPeriod(c.activationDate) : null,
  };
}

export const missingFields = (data) => Object.entries(data).filter(([k, val]) => !k.startsWith("_") && val === TBD).map(([k]) => k);

export function renderDocx(type, data) {
  const { buf, manifest: m } = loadTemplate(type);
  const doc = new Docxtemplater(new PizZip(buf), { paragraphLoop: true, linebreaks: true, nullGetter: () => TBD });
  doc.render(Object.fromEntries(Object.entries(data).filter(([k]) => !k.startsWith("_"))));
  return { docx: doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" }), manifest: m };
}

/** DOCX → PDF. Staging: local LibreOffice. Production: a private Gotenberg (LibreOffice) service. */
export async function toPdf(docx) {
  const provider = (process.env.DOC_PDF_PROVIDER || "soffice").trim();
  if (provider === "gotenberg") {
    const url = (process.env.DOC_GOTENBERG_URL || "").replace(/\/$/, "");
    if (!url) throw new Error("DOC_GOTENBERG_URL is not set.");
    const fd = new FormData(); fd.append("files", new Blob([docx]), "document.docx");
    const r = await fetch(`${url}/forms/libreoffice/convert`, { method: "POST", body: fd });
    if (!r.ok) throw new Error(`PDF conversion failed (${r.status}).`);
    return Buffer.from(await r.arrayBuffer());
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cmdoc-"));
  try {
    fs.writeFileSync(path.join(dir, "document.docx"), docx);
    await new Promise((res, rej) => execFile(process.env.SOFFICE_BIN || "soffice", ["--headless", "--norestore", `-env:UserInstallation=file://${dir}/profile`, "--convert-to", "pdf", "--outdir", dir, path.join(dir, "document.docx")], { timeout: 120000 }, (e) => (e ? rej(e) : res())));
    return fs.readFileSync(path.join(dir, "document.pdf"));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

export const newDocId = (type, now = new Date()) =>
  `CM-${type === "pilot" ? "PO" : "LO"}-${now.toISOString().slice(0, 10).replace(/-/g, "")}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;

/** Generates one document version. Returns metadata + buffers; the caller stores them and writes the audit trail. */
export async function generateDocument(type, input, { version = 1, docId = newDocId(type), now = new Date() } = {}) {
  const m = manifest();
  const draft = m.approved !== true; // DRAFT until counsel approves the templates
  const data = type === "pilot" ? pilotData(input, { docId, version, draft }) : annualData(input, { docId, version, draft, now });
  const { docx } = renderDocx(type, data);
  const pdf = await toPdf(docx);
  return {
    docId, version, type, draft, templateVersion: m.template_version, templateSha256: m.templates[TYPES[type]].sha256, sourceSha256: m.source.sha256,
    docxSha256: sha256(docx), pdfSha256: sha256(pdf), inputSha256: sha256(Buffer.from(JSON.stringify(input))),
    missing: missingFields(data), quote: data._quote || null, pilotPeriod: data._period || null, docx, pdf, generatedAt: now.toISOString(),
  };
}
