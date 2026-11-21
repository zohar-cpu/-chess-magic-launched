import test from "node:test";
import assert from "node:assert/strict";
import { quote } from "../../lib/academy/pricing.js";
import { validateLead, validateAction } from "../../lib/academy/validate.js";

test("validation", () => {
  const base = { submissionId: "abcdef12-3456", fullName: "Jane Doe", email: "jane@district.org",
    jobTitle: "Superintendent", orgName: "Sample USD", orgType: "School District", state: "Texas",
    licenses: 1200, consent: true };
  assert.equal(validateLead(base).ok, true);
  assert.equal(validateLead({ ...base, email: "jane@gmail.com" }).ok, false);
  assert.equal(validateLead({ ...base, consent: false }).ok, false);
  assert.equal(validateLead({ ...base, orgType: "University" }).ok, false);
  assert.equal(validateLead({ ...base, licenses: 12.5 }).ok, false);
  const tok = "a".repeat(64), pid = "3feba0a2da2c80b0bcbf000bc1246789";
  assert.equal(validateAction({ action: "sign_review", pageId: pid, token: tok, authorized: false }).ok, false);
  assert.equal(validateAction({ action: "sign_review", pageId: pid, token: tok, authorized: true }).ok, true);
  assert.equal(validateAction({ action: "request_offer", pageId: pid, token: tok, method: "Zoom call", preferredTime: "Tue AM" }).ok, true);
  assert.equal(validateAction({ action: "request_offer", pageId: pid, token: tok, method: "Fax", preferredTime: "Tue AM" }).ok, false);
});

import { orgKey, buildPage } from "../../lib/academy/notion.js";
test("notion: org key and page payload", () => {
  assert.equal(orgKey("The Sample  USD, Inc."), orgKey("sample usd"));
  process.env.NOTION_DATA_SOURCE_ID = "3feba0a2-da2c-80b0-bcbf-000bc124678e";
  const lead = { submissionId: "abcdef12-3456", path: "reserve", fullName: "Jane Doe", email: "jane@district.org",
    jobTitle: "CFO", orgName: "Sample USD", orgType: "School District", state: "Texas", licenses: 1000,
    phone: null, utm: {}, isTest: true };
  const p = buildPage(lead, quote(1000), { reference: "LE26-TEST" });
  assert.equal(p.properties["LaunchEd Discount"].number, 0.3);
  assert.equal(p.properties["Agreement Status"].select.name, "Not sent");
  assert.equal(p.parent.data_source_id, "3feba0a2-da2c-80b0-bcbf-000bc124678e");
  assert.equal(p.properties["Lead Source"].select.name, "LaunchEd Showcase 2026");
  assert.equal(p.properties["Annual Contract Value"].number, 36750);   // marginal: 500×$52.50 + 500×$21
  assert.equal(p.properties["Event Price per Student"].number, 36.75); // blended average
  assert.equal(p.properties["Test Record"].checkbox, true);
  assert.match(p.properties.Name.title[0].text.content, /^\[TEST\] Sample USD$/);
});

test("academy campaign: pilot + offer", () => {
  process.env.NOTION_DATA_SOURCE_ID = "3feba0a2-da2c-80b0-bcbf-000bc124678e";
  const base = { submissionId: "abcdef12-9999", fullName: "Jane Doe", email: "jane@district.org", jobTitle: "Principal",
    orgName: "Sample USD", orgType: "School District", state: "Texas", consent: true, campaign: "academy-2026" };
  // pilot requests are refused by the commercial endpoint (they use /api/pilot-register)
  assert.equal(validateLead({ ...base, option: "pilot", pilotStudents: 120 }).ok, false);
  assert.equal(validateLead({ ...base }).ok, false);
  const ov = validateLead({ ...base, option: "offer", licenses: 1000 });
  assert.equal(ov.ok, true);
  const op = buildPage({ ...ov.lead, utm: {}, isTest: false }, quote(1000), { reference: "LE26-Y" });
  assert.equal(op.properties["Campaign Option"].select.name, "30% Launch Offer");
  assert.equal(op.properties["Annual Contract Value"].number, 36750);
  assert.equal(op.properties["Renewal Annual Price"].number, 52500);
  // showcase requests (no campaign) behave exactly as before
  const sv = validateLead({ ...base, campaign: undefined, licenses: 1000 });
  assert.equal(sv.ok, true); assert.equal(sv.lead.campaign, "showcase-2026");
  const sp = buildPage({ ...sv.lead, utm: {}, isTest: false }, quote(1000), { reference: "LE26-Z" });
  assert.equal(sp.properties["Lead Source"].select.name, "LaunchEd Showcase 2026");
  assert.equal(sp.properties["Campaign Option"], undefined);
});

test("email-campaign quote request is recorded as 'Request a Quote' and never as a signing", async () => {
  const { buildPage } = await import("../../lib/academy/notion.js");
  const base = { submissionId: "abcdef12-3456", fullName: "Jane Doe", email: "jane@district.org", jobTitle: "Director",
    orgName: "Sample USD", orgType: "School District", state: "Texas", licenses: 1000, consent: true,
    campaign: "academy-2026", option: "offer", intent: "quote" };
  const { lead } = validateLead(base);
  const p = buildPage(lead, quote(1000), { reference: "LE26-TEST" });
  assert.equal(p.properties["LaunchEd Path"].select.name, "Request a Quote");
  assert.equal(p.properties["Agreement Status"].select.name, "Not sent");
  assert.equal(p.properties["Sales Status"].status.name, "Not started");
  assert.equal(p.properties["Annual Contract Value"].number, 36750);
  assert.equal(p.properties["Annual Savings"].number, 15750);
  assert.equal(p.properties["Renewal Annual Price"].number, 52500);
  assert.equal(p.properties["Offer Valid Until"], undefined); // only set when the window is active
  const p2 = buildPage({ ...lead, offerEnds: "2026-12-30" }, quote(1000), { reference: "LE26-TEST" });
  assert.equal(p2.properties["Offer Valid Until"].date.start, "2026-12-30");
  const p3 = buildPage({ ...lead, offerEnds: null }, quote(1000, { discount: false }), { reference: "LE26-TEST" });
  assert.equal(p3.properties["Annual Contract Value"].number, 52500); assert.equal(p3.properties["LaunchEd Discount"], undefined);
});
