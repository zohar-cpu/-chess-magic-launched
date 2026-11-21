// Confirmation emails. External sending is OFF unless explicitly enabled.
//   EMAIL_MODE=off      (default) nothing is sent; the attempt is logged without personal data.
//   EMAIL_MODE=capture  staging/QA: messages are kept in memory (outbox) for inspection. Nothing leaves the server.
//   EMAIL_MODE=send     production: sends through Resend, and ONLY if EMAIL_SENDING_APPROVED=true,
//                       RESEND_API_KEY and EMAIL_FROM (a verified sender domain) are all set.
// Emails contain no student information. A failed email never undoes a saved request.
import { usd, int, DISCOUNT_PCT } from "./pricing.js";

const env = (k) => (process.env[k] || "").trim();
export const outbox = [];
export const emailMode = () => {
  const m = env("EMAIL_MODE") || "off";
  if (m === "send" && !(env("EMAIL_SENDING_APPROVED") === "true" && env("RESEND_API_KEY") && env("EMAIL_FROM"))) return "off";
  return ["off", "capture", "send"].includes(m) ? m : "off";
};

export async function sendEmail({ to, subject, text, html, kind, reference }) {
  const mode = emailMode();
  if (mode === "capture") { outbox.push({ to, subject, text, html, kind, reference, at: new Date().toISOString() }); return { status: "captured" }; }
  if (mode === "off") { console.log(`[email] ${kind} for ${reference} not sent (EMAIL_MODE=off)`); return { status: "disabled" }; }
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env("EMAIL_FROM"), to: [to], subject, text, html, ...(env("EMAIL_REPLY_TO") ? { reply_to: env("EMAIL_REPLY_TO") } : {}) }),
    });
    if (!r.ok) throw new Error(`Resend ${r.status}`);
    return { status: "sent" };
  } catch (e) { console.error(`[email] ${kind} for ${reference} failed: ${e.message}`); return { status: "failed" }; }
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const wrap = (title, body) => `<!doctype html><html><body style="margin:0;background:#F5F7FC;font-family:Arial,Helvetica,sans-serif;color:#172033">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border:1px solid #E2E8F0;border-radius:12px">
<tr><td style="background:#0E1C41;border-radius:12px 12px 0 0;padding:20px 24px;color:#fff;font-size:20px;font-weight:bold">ChessMagic</td></tr>
<tr><td style="padding:24px;font-size:15px;line-height:1.55"><h1 style="margin:0 0 12px;font-size:20px;color:#0E1C41">${esc(title)}</h1>${body}</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #E2E8F0;font-size:12px;color:#5B6780">Chess-Magic Inc. · You are receiving this because you submitted a request on our website. This is a transactional message.</td></tr>
</table></td></tr></table></body></html>`;

export function pilotConfirmation(p, reference) {
  const subject = `Your ChessMagic pilot request (${reference})`;
  const text = [
    `Hi ${p.fullName},`, "",
    `Thank you for requesting a free 30-day ChessMagic pilot for ${p.orgName} (${p.state}, about ${int(p.pilotStudents)} students).`,
    `Reference: ${reference}`, "",
    "What happens next:",
    "1. A ChessMagic team member contacts you to confirm your school's approvals.",
    "2. Where required, your school and Chess-Magic Inc. sign a student data protection agreement.",
    "3. Student accounts are activated only then, and your 30 days begin on that day.", "",
    "No student accounts have been created and no student information has been collected.",
    "This request is not a purchase and creates no annual license commitment.", "",
    "Please do not reply with any student information.", "— The ChessMagic team",
  ].join("\n");
  const html = wrap("Your pilot request has been received", `<p>Hi ${esc(p.fullName)},</p>
<p>Thank you for requesting a free 30-day ChessMagic pilot for <b>${esc(p.orgName)}</b> (${esc(p.state)}, about ${int(p.pilotStudents)} students).</p>
<p style="background:#F5F7FC;border-radius:8px;padding:10px 12px">Reference: <b>${esc(reference)}</b></p>
<p style="margin-bottom:6px"><b>What happens next</b></p><ol style="margin-top:0;padding-left:20px">
<li>A ChessMagic team member contacts you to confirm your school's approvals.</li>
<li>Where required, your school and Chess-Magic Inc. sign a student data protection agreement.</li>
<li>Student accounts are activated only then, and your 30 days begin on that day.</li></ol>
<p>No student accounts have been created and no student information has been collected. This request is not a purchase and creates no annual license commitment.</p>
<p style="color:#5B6780;font-size:13px">Please do not reply with any student information.</p>`);
  return { to: p.email, subject, text, html, kind: "pilot_confirmation", reference };
}

export function quoteConfirmation(lead, q, reference, window) {
  const subject = `Your ChessMagic first-year quote request (${reference})`;
  const ok = q && q.status === "ok";
  const rows = ok ? q.bands.map((b) => `Students ${int(b.from)}–${int(b.to)}: ${int(b.count)} × ${usd(b.firstYearUnitCents)} = ${usd(b.firstYearCents)}`) : [];
  const offerLine = ok && q.discountApplied
    ? `The ${DISCOUNT_PCT}% launch discount applies to the first year only${window?.endsDate ? ` and is available for requests received by ${fmtDate(window.endsDate)}` : ""}. From year two, licenses renew at the standard annual price (${usd(q.renewalAnnualCents)} for ${int(q.licenses)} students at current rates), subject to your contract terms.`
    : ok ? "This estimate uses standard annual pricing." : "";
  const text = [
    `Hi ${lead.fullName},`, "",
    `Thank you for requesting a first-year quote for ${lead.orgName}.`, `Reference: ${reference}`, "",
    ...(ok ? [`Estimate for ${int(q.licenses)} student licenses (progressive tiers):`, ...rows,
              `First-year total: ${usd(q.firstYearTotalCents)} (standard ${usd(q.standardTotalCents)}; you save ${usd(q.savingsCents)})`, offerLine]
           : [`${int(lead.licenses)} student licenses: our team will prepare custom pricing.`]),
    "", "Prices are in USD and exclude applicable taxes. This estimate is not a binding offer or commitment; final pricing is set in a signed order form.",
    "Our team will prepare your formal quote for your procurement team.", "— The ChessMagic team",
  ].join("\n");
  const table = ok ? `<table role="presentation" cellpadding="6" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:14px">
${q.bands.map((b) => `<tr><td style="border-top:1px solid #E2E8F0">Students ${int(b.from)}–${int(b.to)}</td><td style="border-top:1px solid #E2E8F0;text-align:right">${int(b.count)} × ${usd(b.firstYearUnitCents)}</td><td style="border-top:1px solid #E2E8F0;text-align:right">${usd(b.firstYearCents)}</td></tr>`).join("")}
<tr><td colspan="2" style="border-top:2px solid #0E1C41"><b>First-year total</b></td><td style="border-top:2px solid #0E1C41;text-align:right"><b>${usd(q.firstYearTotalCents)}</b></td></tr>
<tr><td colspan="2" style="color:#5B6780">Standard annual price</td><td style="text-align:right;color:#5B6780">${usd(q.standardTotalCents)}</td></tr>
<tr><td colspan="2" style="color:#6B4100">You save</td><td style="text-align:right;color:#6B4100">${usd(q.savingsCents)}</td></tr></table>` : "";
  const html = wrap("Your quote request has been received", `<p>Hi ${esc(lead.fullName)},</p>
<p>Thank you for requesting a first-year quote for <b>${esc(lead.orgName)}</b>.</p>
<p style="background:#F5F7FC;border-radius:8px;padding:10px 12px">Reference: <b>${esc(reference)}</b></p>
${ok ? `<p style="margin-bottom:6px"><b>Estimate for ${int(q.licenses)} student licenses</b> (progressive tiers)</p>${table}<p>${esc(offerLine)}</p>` : `<p>${int(lead.licenses)} student licenses: our team will prepare custom pricing.</p>`}
<p style="color:#5B6780;font-size:13px">Prices are in USD and exclude applicable taxes. This estimate is not a binding offer or commitment; final pricing is set in a signed order form.</p>`);
  return { to: lead.email, subject, text, html, kind: "quote_confirmation", reference };
}

export const fmtDate = (ymd) => new Date(ymd + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
