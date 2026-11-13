// POST /api/lead-action — Step 2 after a successful registration.
//   Option A "sign_review":   records signing interest. Binding e-signature stays
//                             DISABLED until SIGNING_ENABLED=true (after legal approval).
//   Option B "request_offer": records the offer request + follow-up preference.
// Works only on the visitor's own LaunchEd record (HMAC token) and never overwrites.
import { validateAction } from "../lib/validate.js";
import { notifySales } from "../lib/integrations.js";
import { notionConfigured, verifyActionToken, getLaunchEdPage, recordVisitorAction } from "../lib/notion.js";
import { send, originAllowed } from "../lib/http.js";

export default async function handler(req, res) {
  if (!originAllowed(req)) return send(res, 403, { ok: false, error: "Origin not allowed." });
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return send(res, 405, { ok: false, error: "Method not allowed." }); }
  const body = typeof req.body === "string" ? (() => { try { return JSON.parse(req.body); } catch { return null; } })() : req.body;

  const { ok, errors, action } = validateAction(body);
  if (!ok) return send(res, 422, { ok: false, error: "Please check the highlighted fields.", fields: errors });
  if (!notionConfigured()) return send(res, 503, { ok: false, error: "Our service is temporarily unavailable." });
  if (!verifyActionToken(action.pageId, action.token)) return send(res, 403, { ok: false, error: "This session has expired. Please contact us." });

  let page;
  try {
    page = await getLaunchEdPage(action.pageId);
    await recordVisitorAction(page, action);
  } catch (e) {
    console.error("[lead-action]", e.message);
    return send(res, e.status === 403 ? 403 : 502, { ok: false, error: "We couldn't save your request." });
  }

  const org = (page.properties?.Name?.title || []).map((t) => t.plain_text).join("");
  await notifySales(action.action === "sign_review" ? `[LaunchEd] Option A: wants to sign · ${org}` : `[LaunchEd] Option B: offer requested · ${org}`, [
    `Notion: ${page.url}`,
    action.action === "request_offer" ? `Follow-up: ${action.method}, ${action.preferredTime}` : "Signing authority confirmed; e-signature not yet enabled.",
  ]).catch(() => false);

  return send(res, 200, {
    ok: true,
    action: action.action,
    signingEnabled: false, // binding signatures are off until the agreement is approved
  });
}
