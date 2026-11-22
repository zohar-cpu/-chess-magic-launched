// POST /api/academy/esign-webhook — Dropbox Sign account callback for ChessMagic Academy agreements.
// The ONLY place an Academy record becomes "Signed": after Dropbox Sign confirms that every signer has
// signed (event "signature_request_all_signed"). Nothing is ever marked signed from the website itself.
// - Every event is verified with the Dropbox Sign event hash (HMAC-SHA256 with DROPBOX_SIGN_API_KEY).
// - Repeated deliveries are harmless: a record already "Signed" / "Declined" is not changed again.
// - Test-mode events are ignored unless DROPBOX_SIGN_TEST_MODE is not "false" (i.e. they only count on Preview).
// - Dropbox Sign requires the exact reply "Hello API Event Received".
import { esignVerifyEvent } from "../../lib/academy/integrations.js";
import { getLaunchEdPage, updateLaunchEdRecord, SALES, AGREEMENT } from "../../lib/academy/notion.js";

export const config = { api: { bodyParser: false } };
const OK = "Hello API Event Received";

async function rawBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(typeof c === "string" ? Buffer.from(c) : c);
  return Buffer.concat(chunks);
}
const ack = (res) => { res.setHeader("Content-Type", "text/plain"); return res.status(200).send(OK); };

export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).send("Method not allowed"); }
  let evt;
  try {
    const raw = await rawBody(req);
    const ct = req.headers["content-type"] || "";
    if (ct.includes("multipart/form-data") || ct.includes("application/x-www-form-urlencoded")) {
      const fd = await new Request("http://local/", { method: "POST", headers: { "content-type": ct }, body: raw }).formData();
      evt = JSON.parse(String(fd.get("json")));
    } else {
      evt = JSON.parse(raw.toString("utf8"));
    }
  } catch {
    return res.status(400).send("Bad payload");
  }
  if (!process.env.DROPBOX_SIGN_API_KEY || !esignVerifyEvent(evt)) return res.status(401).send("Invalid signature");

  const type = evt.event.event_type;
  if (type === "callback_test") return ack(res); // the "Test" button in Dropbox Sign settings

  const sr = evt.signature_request || {};
  const meta = sr.metadata || {};
  const pageId = meta.notion_page_id;
  const liveOnly = (process.env.DROPBOX_SIGN_TEST_MODE || "").trim() === "false";
  if (!pageId || meta.source !== "chessmagic-academy") return ack(res); // not an Academy agreement: ignore safely
  if (sr.test_mode && liveOnly) { console.warn(`[academy-esign] ignored test-mode event ${type} for ${meta.reference}`); return ack(res); }

  try {
    if (type === "signature_request_all_signed" || type === "signature_request_declined") {
      const page = await getLaunchEdPage(pageId); // refuses records this integration did not create
      const current = page.properties?.["Agreement Status"]?.select?.name;
      if (current === AGREEMENT.signed || current === AGREEMENT.declined) return ack(res); // already final: no duplicate update
      if (type === "signature_request_all_signed") {
        await updateLaunchEdRecord(pageId, {
          salesStatus: SALES.signed, agreementStatus: AGREEMENT.signed,
          note: `SIGNED: agreement fully executed in Dropbox Sign${sr.test_mode ? " (TEST MODE, not binding)" : ""}. Reference ${meta.reference} · signature request ${sr.signature_request_id} · ${new Date().toISOString()}. Download the signed copy from Dropbox Sign.`,
        });
      } else {
        await updateLaunchEdRecord(pageId, {
          agreementStatus: AGREEMENT.declined,
          note: `DECLINED in Dropbox Sign${sr.test_mode ? " (TEST MODE)" : ""}. Reference ${meta.reference} · signature request ${sr.signature_request_id} · ${new Date().toISOString()}. Please follow up with the school.`,
        });
      }
    }
  } catch (e) {
    console.error("[academy-esign]", e.message);
    return res.status(500).send("Processing error"); // Dropbox Sign retries later
  }
  return ack(res);
}
