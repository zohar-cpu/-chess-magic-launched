// POST /api/lead-action — Step 2 after a successful registration.
//   "sign_review":   the contact confirmed signing authority; Agreement Status → "Pending (sales to send)".
//                    The website never sends or signs agreements: sales sends the approved GT agreement
//                    through Dropbox Sign and sets "Signed" after Dropbox Sign confirms completion.
//   "schedule_call": the contact opened the ChessMagic booking page (no obligation, no signing).
//   Option B "request_offer": records the offer request + follow-up preference.
// Works only on the visitor's own LaunchEd record (HMAC token) and never overwrites.
import { validateAction } from "../../lib/academy/validate.js";
import { notifySales } from "../../lib/academy/integrations.js";
import { notionConfigured, verifyActionToken, getLaunchEdPage, recordVisitorAction } from "../../lib/academy/notion.js";
import { send, originAllowed } from "../../lib/academy/http.js";

export default async function handler(req, res) {
  if (!originAllowed(req)) return send(res, 403, { ok: false, error: "Origin not allowed." });
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return send(res, 405, { ok: false, error: "Method not allowed." }); }
  const body = typeof req.body === "string" ? (() => { try { return JSON.parse(req.body); } catch { return null; } })() : req.body;

  const { ok, errors, action } = validateAction(body);
  if (!ok) return send(res, 422, { ok: false, error: "Please check the highlighted fields.", fields: errors });
  if (!notionConfigured()) return send(res, 503, { ok: false, error: "Our service is temporarily unavailable." });
  if (!verifyActionToken(action.pageId, action.token)) return send(res, 403, { ok: false, error: "This session has expired. Please contact us." });

  let page, rec;
  try {
    page = await getLaunchEdPage(action.pageId);
    rec = await recordVisitorAction(page, action);
  } catch (e) {
    console.error("[lead-action]", e.message);
    return send(res, e.status === 403 ? 403 : 502, { ok: false, error: "We couldn't save your request." });
  }

  const org = (page.properties?.Name?.title || []).map((t) => t.plain_text).join("");
  if (action.action === "schedule_call") return send(res, 200, { ok: true, action: action.action, recorded: rec?.changed !== false ? "recorded" : "already_recorded" });
  await notifySales(action.action === "sign_review" ? `[LaunchEd] Option A: wants to sign · ${org}` : `[LaunchEd] Option B: offer requested · ${org}`, [
    `Notion: ${page.url}`,
    action.action === "request_offer" ? `Follow-up: ${action.method}, ${action.preferredTime}` : "Signing authority confirmed; e-signature not yet enabled.",
  ]).catch(() => false);

  return send(res, 200, {
    ok: true,
    action: action.action,
    recorded: rec?.changed !== false ? "recorded" : "already_recorded",
    signingEnabled: false, // the website never sends or signs agreements; sales sends them through Dropbox Sign
  });
}
