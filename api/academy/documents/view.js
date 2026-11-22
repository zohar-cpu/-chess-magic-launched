// GET /api/documents/view?t=<signed token>[&download=1] — customer review + download of ONE document.
// The token is HMAC-signed, expires (14 days) and is bound to the document's SHA-256, so a regenerated
// or altered file cannot be served under an old link. Every view/download is written to the audit trail.
import crypto from "node:crypto";
import { verifyReviewToken, store, audit } from "../../../lib/academy/doc-records.js";

export default async function handler(req, res) {
  const u = new URL(req.url, "http://x");
  const t = verifyReviewToken(u.searchParams.get("t"));
  if (!t) { res.statusCode = 404; return res.end("This link is invalid or has expired."); }
  let pdf;
  try { pdf = await store.get(`${t.docId}-v${t.version}.pdf`); } catch { res.statusCode = 404; return res.end("Document not found."); }
  const sha = crypto.createHash("sha256").update(pdf).digest("hex");
  if (!sha.startsWith(t.shaPrefix)) { res.statusCode = 409; return res.end("This document has changed. Please ask for a new link."); }
  const dl = u.searchParams.get("download") === "1";
  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  await audit({ docId: t.docId, version: t.version, event: dl ? "downloaded" : "viewed", actor: "customer", pdfSha256: sha,
    ipHash: ip ? crypto.createHash("sha256").update("ip:" + ip).digest("hex").slice(0, 32) : null }).catch(() => {});
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `${dl ? "attachment" : "inline"}; filename="${t.docId}-v${t.version}.pdf"`);
  res.setHeader("Cache-Control", "private, no-store"); res.setHeader("X-Robots-Tag", "noindex");
  res.end(pdf);
}
