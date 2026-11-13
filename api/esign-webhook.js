// POST /api/esign-webhook — Dropbox Sign callback.
// The ONLY place a record becomes "Done WIN" / "Signed": after the provider
// confirms every signer (customer + Chess-Magic countersigner) has signed.
import { esignVerifyEvent, notifySales } from "../lib/integrations.js";
import { updateLaunchEdRecord, SALES, AGREEMENT } from "../lib/notion.js";

export const config = { api: { bodyParser: false } };

async function rawBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
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

  if (!esignVerifyEvent(evt)) return res.status(401).send("Invalid signature");

  const type = evt.event.event_type;
  const sr = evt.signature_request || {};
  const meta = sr.metadata || {};
  const pageId = meta.notion_page_id;

  try {
    if (type === "signature_request_all_signed" && pageId) {
      await updateLaunchEdRecord(pageId, {
        salesStatus: SALES.signed, agreementStatus: AGREEMENT.signed,
        note: `Agreement fully executed via Dropbox Sign (request ${sr.signature_request_id}) on ${new Date().toISOString()}.`,
      });
      await notifySales(`[LaunchEd] SIGNED · ${meta.reference}`, [`Notion page ${pageId}`, `Signature request ${sr.signature_request_id}`]);
    } else if (type === "signature_request_declined" && pageId) {
      await updateLaunchEdRecord(pageId, { agreementStatus: AGREEMENT.declined });
      await notifySales(`[LaunchEd] Agreement DECLINED · ${meta.reference}`, [`Notion page ${pageId}`]);
    }
  } catch (e) {
    console.error("[esign-webhook]", e.message);
    return res.status(500).send("Processing error"); // provider retries
  }

  res.setHeader("Content-Type", "text/plain");
  return res.status(200).send("Hello API Event Received");
}
