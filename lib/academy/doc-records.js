// Secure storage, audit trail and review links for generated agreement documents.
// * Files (PDF + DOCX) are stored privately, keyed by SHA-256. Staging: local folder. Production:
//   a private S3-compatible bucket (server-side encryption, no public URLs) [to be provisioned].
// * Audit trail: append-only rows in the private Postgres database (same one as the consent log).
//   Every event stores the document hash, so any later change to a file is detectable.
// * Review links: signed, expiring HMAC tokens. Customers can view and download only their own document.
// * Notion receives METADATA only (type, status, version, pricing, dates, approval/signature status).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { neon } from "@neondatabase/serverless";

const env = (k) => (process.env[k] || "").trim();

/* ---------------- storage ---------------- */
export const store = {
  async put(key, buf) {
    if ((env("DOC_STORAGE") || "local") !== "local") throw new Error("Production document storage is not configured yet.");
    const dir = env("DOC_LOCAL_DIR") || "/tmp/chessmagic-docs";
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(dir, key), buf, { mode: 0o600 });
    return { key };
  },
  async get(key) {
    const dir = env("DOC_LOCAL_DIR") || "/tmp/chessmagic-docs";
    if (!/^[\w.-]+$/.test(key)) throw new Error("bad key");
    return fs.readFileSync(path.join(dir, key));
  },
};

/* ---------------- audit trail (append-only) ---------------- */
let sqlFn = null, ready = false;
const sql = () => (sqlFn ||= neon(env("DATABASE_URL")));
export function _setSqlForTests(fn) { sqlFn = fn; ready = false; }
async function ensure() {
  if (ready) return;
  await sql()`CREATE TABLE IF NOT EXISTS agreement_document_events (
    id BIGSERIAL PRIMARY KEY, doc_id TEXT NOT NULL, version INT NOT NULL, event TEXT NOT NULL,
    at TIMESTAMPTZ NOT NULL DEFAULT now(), actor TEXT, doc_type TEXT, template_version TEXT,
    template_sha256 TEXT, pdf_sha256 TEXT, docx_sha256 TEXT, input_sha256 TEXT, ip_hash TEXT, detail JSONB)`;
  ready = true;
}
export const EVENTS = ["generated", "internal_approved", "sent_for_review", "viewed", "downloaded", "superseded", "voided"]; // signing events added only when e-signature is approved
export async function audit(e) {
  if (!EVENTS.includes(e.event)) throw new Error(`Unknown event ${e.event}`);
  await ensure();
  await sql()`INSERT INTO agreement_document_events (doc_id, version, event, actor, doc_type, template_version, template_sha256, pdf_sha256, docx_sha256, input_sha256, ip_hash, detail)
    VALUES (${e.docId}, ${e.version}, ${e.event}, ${e.actor || null}, ${e.type || null}, ${e.templateVersion || null}, ${e.templateSha256 || null},
            ${e.pdfSha256 || null}, ${e.docxSha256 || null}, ${e.inputSha256 || null}, ${e.ipHash || null}, ${JSON.stringify(e.detail || {})})`;
}

/* ---------------- signed review links ---------------- */
function linkKey() {
  const explicit = env("DOC_LINK_SECRET");
  if (explicit) return Buffer.from(explicit);
  // Derived automatically (HKDF-SHA256) from the server-side Notion token: nothing to generate by hand.
  return Buffer.from(crypto.hkdfSync("sha256", env("NOTION_API_TOKEN"), "chess-magic-documents", "review-link-v1", 32));
}
export function reviewToken(docId, version, pdfSha256, expiresAt) {
  const payload = `${docId}.${version}.${pdfSha256.slice(0, 16)}.${expiresAt}`;
  const sig = crypto.createHmac("sha256", linkKey()).update(payload).digest("base64url");
  return Buffer.from(payload).toString("base64url") + "." + sig;
}
export function verifyReviewToken(token, now = Date.now()) {
  const [p, sig] = String(token || "").split(".");
  if (!p || !sig) return null;
  const payload = Buffer.from(p, "base64url").toString();
  const want = crypto.createHmac("sha256", linkKey()).update(payload).digest("base64url");
  if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  const [docId, version, shaPrefix, exp] = payload.split(".");
  if (!(+exp > now)) return null;
  return { docId, version: +version, shaPrefix, expiresAt: +exp };
}

/* ---------------- Notion metadata (proposed "Agreement Documents" database; not created yet) ---------------- */
export function notionDocumentProps(g, { orgPageId, status = "Draft generated" }) {
  const q = g.quote;
  return {
    Name: { title: [{ text: { content: `${g.docId} v${g.version}` } }] },
    Organization: { relation: [{ id: orgPageId }] },
    "Document Type": { select: { name: g.type === "pilot" ? "Pilot Order Form" : "Annual License Order Form" } },
    Status: { select: { name: status } },
    Version: { number: g.version },
    "Template Version": { rich_text: [{ text: { content: g.templateVersion } }] },
    "Approval Status": { select: { name: g.draft ? "Pending counsel approval" : "Approved template" } },
    "Signature Status": { select: { name: "Not enabled" } },
    ...(q ? { Licenses: { number: q.licenses }, "Standard Annual": { number: q.standardTotalCents / 100 }, "First-Year Total": { number: q.firstYearTotalCents / 100 },
              Savings: { number: q.savingsCents / 100 }, "Renewal Annual": { number: q.renewalAnnualCents / 100 } } : {}),
    ...(g.pilotPeriod ? { "Effective Date": { date: { start: g.pilotPeriod.start, end: g.pilotPeriod.end } } } : {}),
    "Generated At": { date: { start: g.generatedAt } },
    "PDF SHA-256": { rich_text: [{ text: { content: g.pdfSha256 } }] },
  };
}
