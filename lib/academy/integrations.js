// Third-party adapters. Each one reports whether it is configured; nothing is
// ever faked. If a required integration is missing, the API returns 503.
import crypto from "node:crypto";
import { usd } from "./pricing.js";

const env = (k) => (process.env[k] || "").trim();

/* ------------------------------------------------------------------ */
/* E-signature: Dropbox Sign (template-based, emails the signer)        */
/* ------------------------------------------------------------------ */
const DS = "https://api.hellosign.com/v3";
export const esignConfigured = () => !!(env("DROPBOX_SIGN_API_KEY") && env("DROPBOX_SIGN_TEMPLATE_ID"));

/** Sends the licensing agreement for signature. Returns { signatureRequestId }. */
export async function esignSend(lead, q, reference, dealId /* Notion page id */) {
  const fields = {
    org_name: lead.orgName, org_type: lead.orgType, org_state: lead.state,
    signer_name: lead.fullName, signer_title: lead.jobTitle, signer_email: lead.email,
    licenses: String(lead.licenses), pricing_model: "progressive (marginal) tiers",
    discount_pct: `${q.discountPct}%`, annual_total_standard: usd(q.standardTotalCents),
    first_year_total: usd(q.firstYearTotalCents), annual_savings: usd(q.savingsCents), renewal_annual: usd(q.renewalAnnualCents),
    reference,
  };
  const body = {
    template_ids: [env("DROPBOX_SIGN_TEMPLATE_ID")],
    subject: `Chess Magic Licensing Agreement · ${lead.orgName}`,
    message: "Please review and sign your Chess Magic LaunchEd 2026 licensing agreement. All amounts exclude applicable taxes.",
    signers: [{ role: env("DROPBOX_SIGN_SIGNER_ROLE") || "Client", name: lead.fullName, email_address: lead.email }],
    ...(env("DROPBOX_SIGN_CC_ROLE") && env("SALES_NOTIFY_EMAIL")
      ? { ccs: [{ role: env("DROPBOX_SIGN_CC_ROLE"), email_address: env("SALES_NOTIFY_EMAIL") }] } : {}),
    custom_fields: Object.entries(fields).map(([name, value]) => ({ name, value })),
    metadata: { reference, notion_page_id: String(dealId || ""), source: "launched-2026" },
    test_mode: env("DROPBOX_SIGN_TEST_MODE") !== "false",
  };
  const r = await fetch(`${DS}/signature_request/send_with_template`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(env("DROPBOX_SIGN_API_KEY") + ":").toString("base64"),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Dropbox Sign request failed (${r.status}): ${j?.error?.error_msg || "unknown"}`);
  return { signatureRequestId: j.signature_request.signature_request_id };
}

/** Verifies a Dropbox Sign callback event. */
export function esignVerifyEvent(evt) {
  const { event_time, event_type, event_hash } = evt?.event || {};
  if (!event_time || !event_type || !event_hash) return false;
  const expected = crypto.createHmac("sha256", env("DROPBOX_SIGN_API_KEY")).update(event_time + event_type).digest("hex");
  const a = Buffer.from(expected), b = Buffer.from(String(event_hash));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ------------------------------------------------------------------ */
/* Notifications: Resend email and/or Slack incoming webhook            */
/* ------------------------------------------------------------------ */
export const notifyConfigured = () => !!((env("RESEND_API_KEY") && env("SALES_NOTIFY_EMAIL") && env("NOTIFY_FROM_EMAIL")) || env("SLACK_WEBHOOK_URL"));

export async function notifySales(subject, lines) {
  // Internal notifications follow the same switch as customer emails: nothing leaves the server
  // unless EMAIL_MODE=send and EMAIL_SENDING_APPROVED=true.
  const { emailMode, outbox } = await import("./email.js");
  const mode = emailMode();
  if (mode === "capture") { outbox.push({ to: "sales (internal)", subject, text: lines.filter(Boolean).join("\n"), kind: "internal_notification" }); return true; }
  if (mode === "off") return false;
  const text = lines.filter(Boolean).join("\n");
  const jobs = [];
  if (env("RESEND_API_KEY") && env("SALES_NOTIFY_EMAIL") && env("NOTIFY_FROM_EMAIL")) {
    jobs.push(fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env("NOTIFY_FROM_EMAIL"), to: env("SALES_NOTIFY_EMAIL").split(","), subject, text }),
    }).then((r) => { if (!r.ok) throw new Error(`Resend ${r.status}`); }));
  }
  if (env("SLACK_WEBHOOK_URL")) {
    jobs.push(fetch(env("SLACK_WEBHOOK_URL"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `*${subject}*\n${text}` }),
    }).then((r) => { if (!r.ok) throw new Error(`Slack ${r.status}`); }));
  }
  const res = await Promise.allSettled(jobs);
  return res.some((x) => x.status === "fulfilled");
}
