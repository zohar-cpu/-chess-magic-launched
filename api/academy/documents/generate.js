// POST /api/documents/generate — STAFF ONLY. Called by a Notion button/automation ("Generate draft")
// with header X-ChessMagic-Signature = HMAC-SHA256(body) using the server-side DOC_WEBHOOK_SECRET
// (derived automatically from NOTION_API_TOKEN via HKDF if not set). Never callable from the public page.
// Generates a DRAFT document version, stores it privately, writes the audit trail and returns a
// signed, expiring review link. It never sends email and never starts a signature.
import crypto from "node:crypto";
import { generateDocument } from "../../../lib/academy/documents.js";
import { store, audit, reviewToken } from "../../../lib/academy/doc-records.js";
import { send } from "../../../lib/academy/http.js";

const env = (k) => (process.env[k] || "").trim();
const secret = () => env("DOC_WEBHOOK_SECRET") || Buffer.from(crypto.hkdfSync("sha256", env("NOTION_API_TOKEN"), "chess-magic-documents", "staff-webhook-v1", 32)).toString("hex");

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { ok: false });
  if ((env("DOCUMENTS_ENABLED") || "false") !== "true") return send(res, 503, { ok: false, error: "Document generation is not enabled." });
  const raw = typeof req.body === "string" ? req.body : JSON.stringify(req.body || {});
  const sig = String(req.headers["x-chessmagic-signature"] || "");
  const want = crypto.createHmac("sha256", secret()).update(raw).digest("hex");
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return send(res, 401, { ok: false });
  const { type, input, version = 1, docId, actor = "staff" } = JSON.parse(raw);
  if (!["pilot", "annual"].includes(type)) return send(res, 422, { ok: false, error: "Unknown document type." });
  let g;
  try { g = await generateDocument(type, input, { version, ...(docId ? { docId } : {}) }); }
  catch (e) { return send(res, 422, { ok: false, error: e.message }); }
  await store.put(`${g.docId}-v${g.version}.pdf`, g.pdf);
  await store.put(`${g.docId}-v${g.version}.docx`, g.docx);
  await audit({ ...g, event: "generated", actor, detail: { missing: g.missing, draft: g.draft } });
  const exp = Date.now() + 14 * 864e5;
  return send(res, 200, { ok: true, docId: g.docId, version: g.version, draft: g.draft, missing: g.missing, pdfSha256: g.pdfSha256,
    reviewPath: `/api/documents/view?t=${reviewToken(g.docId, g.version, g.pdfSha256, exp)}`, reviewExpires: new Date(exp).toISOString() });
}
