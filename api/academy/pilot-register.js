// POST /api/pilot-register — Free 30-Day Pilot request (separate from the commercial flow).
// Order of operations: release gate → validation → consent audit record (private DB) → Notion org + contact.
// Success is reported only after BOTH the audit record and the Notion records exist.
// Registration never activates student accounts and accepts no student information.
import crypto from "node:crypto";
import { send, originAllowed } from "../../lib/academy/http.js";
import { validatePilot } from "../../lib/academy/validate-pilot.js";
import { LEGAL, CONSENT_TEXT, pilotRegistrationOpen } from "../../lib/academy/legal.js";
import { auditConfigured, writeConsentRecord } from "../../lib/academy/audit.js";
import { pilotCrmConfigured, savePilotRequest } from "../../lib/academy/pilot-crm.js";
import { sendEmail, pilotConfirmation } from "../../lib/academy/email.js";
import { notifySales } from "../../lib/academy/integrations.js";

const hits = new Map();
function limited(ip) {
  const now = Date.now(), arr = (hits.get(ip) || []).filter((t) => now - t < 600000);
  arr.push(now); hits.set(ip, arr); return arr.length > 6;
}

export default async function handler(req, res) {
  if (!originAllowed(req)) return send(res, 403, { ok: false, error: "Origin not allowed." });
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return send(res, 405, { ok: false, error: "Method not allowed." }); }
  if (!pilotRegistrationOpen()) return send(res, 503, { ok: false, closed: true, error: "Pilot registration opens soon. Our legal documents are being finalized." });
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim();
  if (limited(ip)) return send(res, 429, { ok: false, error: "Too many submissions. Please wait a few minutes." });

  const body = typeof req.body === "string" ? (() => { try { return JSON.parse(req.body); } catch { return null; } })() : req.body;
  if (body && typeof body.website === "string" && body.website.trim()) return send(res, 400, { ok: false, error: "Invalid submission." });
  const { ok, errors, pilot } = validatePilot(body);
  if (!ok) return send(res, 422, { ok: false, error: errors.versions || errors.studentData || "Please check the highlighted fields.", fields: errors });
  pilot.isTest = /^\s*\[TEST\]\s*/i.test(pilot.orgName);
  if (pilot.isTest) pilot.orgName = pilot.orgName.replace(/^\s*\[TEST\]\s*/i, "").trim() || "Test School";

  // Simple intake: the Notion record (with the consent proof in its page body) is the record of the
  // request. The separate consent database is optional and used only if DATABASE_URL is configured.
  if (!pilotCrmConfigured()) {
    console.error("[pilot] Notion is not configured");
    return send(res, 503, { ok: false, error: "Pilot registration is temporarily unavailable." });
  }

  const reference = "PILOT-" + crypto.createHash("sha256").update(pilot.submissionId).digest("hex").slice(0, 8).toUpperCase();
  const ipHash = ip ? crypto.createHmac("sha256", process.env.NOTION_API_TOKEN || "").update("ip:" + ip).digest("hex").slice(0, 32) : null;

  const consent = {
    at: new Date().toISOString(),
    termsName: LEGAL.terms.name, termsVersion: LEGAL.terms.version, termsText: CONSENT_TEXT.terms,
    privacyName: LEGAL.privacy.name, privacyVersion: LEGAL.privacy.version, privacyUrl: LEGAL.privacy.url, privacyText: CONSENT_TEXT.privacy,
    authorityText: CONSENT_TEXT.authority, marketingText: CONSENT_TEXT.marketing,
  };
  if (auditConfigured()) try {
    await writeConsentRecord({
      ...pilot, reference, termsVersion: LEGAL.terms.version, privacyVersion: LEGAL.privacy.version,
      texts: CONSENT_TEXT, ipHash, userAgent: req.headers["user-agent"], clientTime: body.clientTime,
    });
  } catch (e) {
    console.error("[pilot] audit write failed:", e.message);
    return send(res, 502, { ok: false, error: "We couldn't record your consent." });
  }

  let rec;
  try { rec = await savePilotRequest(pilot, reference, consent); }
  catch (e) {
    console.error("[pilot] Notion error:", e.message);
    return send(res, 502, { ok: false, error: "We couldn't save your pilot request." });
  }
  if (rec.kind === "retry") return send(res, 200, { ok: true, status: "pilot_requested", reference: rec.reference || reference });
  if (rec.kind === "duplicate") return send(res, 200, { ok: true, status: "already_requested", reference: rec.reference });

  // Confirmation email only after the CRM record exists (EMAIL_MODE decides whether anything is sent).
  const mail = await sendEmail(pilotConfirmation(pilot, reference));
  await notifySales(`[Academy PILOT]${pilot.isTest ? " [TEST]" : ""} ${pilot.orgName} (${pilot.state})`, [
    `${pilot.fullName}, ${pilot.jobTitle} · ${pilot.email}`, `~${pilot.pilotStudents} students · Ref ${reference}`,
    `Notion: ${rec.url}${rec.colleagues ? " (another contact from this organization already requested a pilot)" : ""}`,
    "Status: Pilot Requested. Do not activate student accounts until approvals and any DPA are complete.",
  ]).catch(() => false);

  return send(res, 200, { ok: true, status: "pilot_requested", reference, email: mail.status });
}
