// POST /api/leads — Step 1: registration. Saves a NEW record to the Notion CRM
// and only then returns success. Never reports success unless the record exists.
import crypto from "node:crypto";
import { quote, usd } from "../lib/pricing.js";
import { validateLead } from "../lib/validate.js";
import { notifySales } from "../lib/integrations.js";
import { notionConfigured, findExisting, createLeadPage, actionToken } from "../lib/notion.js";
import { send, originAllowed } from "../lib/http.js";

const hits = new Map();
function limited(ip) {
  const now = Date.now(), win = 10 * 60 * 1000, max = 8;
  const arr = (hits.get(ip) || []).filter((t) => now - t < win);
  arr.push(now); hits.set(ip, arr);
  return arr.length > max;
}
const inflight = new Map(); // per-instance lock: same email+org submitted concurrently

const publicQuote = (q, n) => q.status === "ok"
  ? { status: "ok", licenses: q.licenses, tier: q.tier, discountPct: q.discountPct, standardUnitCents: q.standardUnitCents, eventUnitCents: q.eventUnitCents, standardTotalCents: q.standardTotalCents, eventTotalCents: q.eventTotalCents, savingsCents: q.savingsCents }
  : { status: "custom", licenses: n };

export default async function handler(req, res) {
  if (!originAllowed(req)) return send(res, 403, { ok: false, error: "Origin not allowed." });
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return send(res, 405, { ok: false, error: "Method not allowed." }); }
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim();
  if (limited(ip)) return send(res, 429, { ok: false, error: "Too many submissions. Please wait a few minutes." });

  const body = typeof req.body === "string" ? safeJson(req.body) : req.body;
  if (body && typeof body.website === "string" && body.website.trim()) return send(res, 400, { ok: false, error: "Invalid submission." });

  const { ok, errors, lead } = validateLead(body);
  if (!ok) return send(res, 422, { ok: false, error: "Please check the highlighted fields.", fields: errors });

  // Test registrations: an organization name starting with "[TEST]" is saved with the
  // Test Record box checked (no secret key needed). A LAUNCHED_TEST_KEY, if configured,
  // is still accepted for automated scripts.
  lead.isTest = false;
  const testPrefix = /^\s*\[TEST\]\s*/i;
  if (testPrefix.test(lead.orgName)) {
    lead.orgName = lead.orgName.replace(testPrefix, "").trim() || "Test Organization";
    lead.isTest = true;
  }
  if (body.testKey !== undefined) {
    const k = process.env.LAUNCHED_TEST_KEY || "";
    if (!k || typeof body.testKey !== "string" || body.testKey.length !== k.length ||
        !crypto.timingSafeEqual(Buffer.from(body.testKey), Buffer.from(k))) return send(res, 403, { ok: false, error: "Invalid test key." });
    lead.isTest = true;
  }

  if (!notionConfigured()) {
    console.error("[leads] Notion not configured (NOTION_API_TOKEN / NOTION_DATA_SOURCE_ID).");
    return send(res, 503, { ok: false, error: "Our registration service is temporarily unavailable." });
  }

  const q = quote(lead.licenses);
  const lockKey = `${lead.isTest}|${lead.email}`;
  while (inflight.has(lockKey)) await inflight.get(lockKey);
  let release; inflight.set(lockKey, new Promise((r) => (release = r)));
  try {
    let existing;
    try { existing = await findExisting(lead); }
    catch (e) { console.error("[leads] Notion query error:", e.message); return send(res, 502, { ok: false, error: "We couldn't save your registration." }); }

    if (existing?.kind === "retry") {
      // Same submit received twice (double tap / network retry): return the original record.
      return send(res, 200, { ok: true, status: "registered", reference: existing.reference, pageId: existing.pageId, token: actionToken(existing.pageId), quote: publicQuote(q, lead.licenses) });
    }
    if (existing?.kind === "duplicate") {
      // Same person + same organization already registered: create nothing, change nothing.
      await notifySales(`[LaunchEd] Repeat registration · ${lead.orgName}`, [`Existing record: ${existing.url}`, `${lead.fullName} <${lead.email}>`]).catch(() => false);
      return send(res, 200, { ok: true, status: "already_registered", reference: existing.reference, quote: publicQuote(q, lead.licenses) });
    }

    const reference = "LE26-" + crypto.createHash("sha256").update(lead.submissionId).digest("hex").slice(0, 8).toUpperCase();
    let page;
    try { page = await createLeadPage(lead, q, { reference }); }
    catch (e) { console.error("[leads] Notion create error:", e.message); return send(res, 502, { ok: false, error: "We couldn't save your registration." }); }

    await notifySales(`[LaunchEd]${lead.isTest ? " [TEST]" : ""} New registration · ${lead.orgName}`, [
      `Ref ${reference} · Notion: ${page.url}`, `${lead.orgName} (${lead.orgType}), ${lead.state}`,
      `${lead.fullName}, ${lead.jobTitle} · ${lead.email}${lead.phone ? " · " + lead.phone : ""}`,
      q.status === "ok" ? `${lead.licenses} licenses · ${usd(q.eventUnitCents)}/student · ${usd(q.eventTotalCents)}/yr excl. taxes` : `${lead.licenses} licenses · CUSTOM PRICING`,
    ]).catch(() => false);

    return send(res, 200, { ok: true, status: "registered", reference, pageId: page.pageId, token: actionToken(page.pageId), quote: publicQuote(q, lead.licenses) });
  } finally {
    inflight.delete(lockKey); release();
  }
}

function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }
