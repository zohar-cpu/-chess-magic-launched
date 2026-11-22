// DRAFT Order Form pricing schedule, for counsel's review ONLY. Not an offer, not for signature.
// Legal wording is reproduced from the existing draft (Chess Magic U.S. License Agreement, Order Form);
// only the pricing logic changed to the approved PROGRESSIVE / MARGINAL tiers (2026-11-19).
// Signature fields are rendered as disabled text; SIGNING_ENABLED is never read here.
import { quote, TIERS, DISCOUNT_PCT, usd, int } from "./pricing.js";
import { fmtDate } from "./email.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const TBD = '<span class="tbd">[TO BE CONFIRMED]</span>';
const COUNSEL = (s) => `<span class="tbd">[COUNSEL TO CONFIRM: ${esc(s)}]</span>`;

export function orderFormDraftHTML(c, { reference, window, discount = true } = {}) {
  const q = quote(c.licenses, { discount });
  const ok = q.status === "ok";
  const line = (k, v) => `<div class="of-line"><span>${k}</span><b>${v}</b></div>`;
  const rateRows = TIERS.map((t) => `<tr><td>${int(t.from)}–${int(t.to)}</td><td>${usd(t.unitCents)}</td><td>${DISCOUNT_PCT}%</td><td>${usd(Math.round(t.unitCents * (100 - DISCOUNT_PCT) / 100))}</td></tr>`).join("");
  const bandRows = ok ? q.bands.map((b) => `<tr><td>${int(b.from)}–${int(b.to)}</td><td>${int(b.count)}</td><td>${usd(b.standardUnitCents)}</td><td>${usd(b.standardCents)}</td><td>${usd(b.firstYearUnitCents)}</td><td>${usd(b.firstYearCents)}</td></tr>`).join("") : "";
  return `<article class="of" aria-label="Draft Order Form">
<div class="of-band">DRAFT FOR LEGAL REVIEW ONLY · NOT AN OFFER · NOT FOR SIGNATURE · Final legal terms and pricing pending approval</div>
<h4>CHESS-MAGIC INC. | U.S. LICENSE ORDER FORM</h4><p class="of-sub">ChessMagic Academy Launch</p>
${line("Order Date", '<span class="tbd">[At signature]</span>')}${line("Offer Reference", esc(reference || "[REFERENCE]"))}
<p>This License Order Form (the "Order Form") is entered into by Chess-Magic Inc., a Florida corporation (the "Company"), and the Customer identified below, and incorporates the attached License Terms, EULA (to the extent applicable), and any executed Data Protection Addendum (collectively, the "Agreement").</p>
<p>This Order Form states the commercial terms for annual student licenses to the Chess Magic platform. This proposed Order Form and event pricing are subject to the Company's written acceptance and completion of any required Customer procurement approval.</p>
<h5>CUSTOMER INFORMATION</h5>
${line("Legal Customer / Organization Name", esc(c.orgName))}${line("District / Charter School / Charter School Network", esc(c.orgType))}
${line("Billing Address and State", `${TBD} · ${esc(c.state)}`)}${line("Authorized Signatory (Name and Title)", `${esc(c.fullName)}, ${esc(c.jobTitle)}`)}
${line("Official Work Email", esc(c.email))}${line("Phone", c.phone ? esc(c.phone) : TBD)}
<h5>PRICING SCHEDULE: PROGRESSIVE (MARGINAL) TIERS</h5>
<p>Annual license fees are calculated progressively. Each rate applies only to the student licenses that fall within its band; licenses in a higher band do not change the rate of licenses in a lower band. Orders of fewer than 50 or more than 100,000 student licenses are priced by custom quote.</p>
<table class="of-t"><thead><tr><th>Student licenses in band</th><th>Standard annual price / student (USD)</th><th>Launch discount (first year only)</th><th>First-year price / student (USD)</th></tr></thead><tbody>${rateRows}</tbody></table>
<h5>ORDER DETAILS</h5>
${line("Number of Student Licenses Purchased", int(c.licenses))}
${ok ? `<table class="of-t"><thead><tr><th>Band</th><th>Licenses</th><th>Standard rate</th><th>Standard annual fee</th><th>First-year rate</th><th>First-year fee</th></tr></thead><tbody>${bandRows}
<tr><td colspan="3"><b>Total</b></td><td><b>${usd(q.standardTotalCents)}</b></td><td></td><td><b>${usd(q.firstYearTotalCents)}</b></td></tr></tbody></table>` : '<p class="of-ph">[CUSTOM QUOTE: outside the 50–100,000 range]</p>'}
${line("First-Year License Fees (USD), Excluding Taxes", ok ? usd(q.firstYearTotalCents) : "[CUSTOM QUOTE]")}
${line("Launch Discount", ok && q.discountApplied ? `${DISCOUNT_PCT}% on every band, first contract year only (${usd(q.savingsCents)})` : "Not applied")}
${line("Discount Eligibility", window?.endsDate ? `Order requested on or before ${fmtDate(window.endsDate)} (30-day launch window from ${fmtDate(window.launchDate)})` : COUNSEL("launch window dates"))}
${line("Renewal Annual License Fees (USD), Excluding Taxes", ok ? `${usd(q.renewalAnnualCents)} per year at the standard rates above for the same quantity, ${COUNSEL("renewal term, price-change notice and quantity true-up clause")}` : TBD)}
${line("Applicable Sales / Use Taxes, if any", TBD)}${line("Annual Total Payable (USD)", TBD)}
${line("License Term", "Annual student licenses")}${line("License Start Date", `${TBD} (subject to onboarding readiness)`)}${line("License End Date", TBD)}
<p class="of-ph">Payment Terms: [TO BE AGREED: invoice due date, purchase order requirements, payment method]. Discount Period: first contract year only (approved 2026-11-19). Renewal Rate: standard annual rates per this Pricing Schedule ${COUNSEL("renewal mechanics")}.</p>
<h5>INCORPORATION OF LICENSE AGREEMENT</h5>
<p>This Order Form, the attached License Terms, the applicable EULA, and any fully executed data protection addendum form the Agreement. No student data will be imported or activated until the required privacy and security documentation is completed.</p>
<p>Order Form commercial terms (quantity, pricing, payment schedule, dates, and expressly identified exceptions) control over conflicting general License Terms. A mutually executed Data Protection Addendum controls with respect to student personal data. Otherwise, the License Terms prevail over the EULA for Customer contractual matters. Mandatory applicable law controls in all cases.</p>
<h5>CUSTOMER ACKNOWLEDGMENT AND ACCEPTANCE</h5>
<p>By signing, the Customer acknowledges receipt of this Order Form, License Terms and any documents expressly incorporated by reference and confirms that the documents were accessible for review and retention before signing.</p>
<p>The Customer requests the licenses specified below, subject to the Company's acceptance and applicable procurement and payment conditions stated in this Order Form.</p>
<p>The individual signing for the Customer represents that they are authorized to do so, and that any necessary board, procurement, budget or other approvals have been obtained. A person without such authority should use the nonbinding "Request a Quote" path instead.</p>
<div class="of-sig" aria-disabled="true"><div><h6>CHESS-MAGIC INC.</h6><p>BY: [SIGNATURE DISABLED]</p><p>TITLE: ____</p><p>Date: ____</p></div><div><h6>CUSTOMER</h6><p>BY: [SIGNATURE DISABLED]</p><p>TITLE: ____</p><p>Date: ____</p></div></div>
<p class="of-foot">The License Terms, EULA and any Data Protection Addendum will be provided with the final agreement for review and retention before signing. Signature fields are disabled until the final legal terms are approved.</p>
</article>`;
}

export const ORDER_FORM_CSS = `body{font:14px/1.5 Arial,Helvetica,sans-serif;color:#172033;max-width:860px;margin:24px auto;padding:0 16px}
.of-band{background:#FEF0EE;color:#B42318;font-weight:800;font-size:12px;padding:8px 10px;border-radius:8px;text-align:center}
h4{text-align:center;margin:16px 0 0}.of-sub{text-align:center;color:#5B6780;margin:2px 0 12px}h5{margin:18px 0 6px;font-size:13px;letter-spacing:.03em}
.of-line{display:flex;justify-content:space-between;gap:12px;border-bottom:1px dotted #CBD5E1;padding:6px 0}.of-line span{color:#3E4A63}.of-line b{text-align:right}
.of-t{border-collapse:collapse;width:100%;font-size:12.5px;margin:6px 0}.of-t th,.of-t td{border:1px solid #E2E8F0;padding:6px 8px;text-align:left}.of-t th{background:#F5F7FC}
.of-ph{background:#F5F7FC;border:1px dashed #CBD5E1;padding:10px;border-radius:8px}.tbd{color:#8A5A00;font-weight:700}
.of-sig{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:14px;opacity:.7}.of-foot{font-size:12px;color:#5B6780}`;
