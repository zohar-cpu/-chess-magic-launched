import test from "node:test";
import assert from "node:assert/strict";
import { quote } from "../lib/pricing.js";
import { validateLead, validateAction } from "../lib/validate.js";

test("tier boundaries", () => {
  assert.equal(quote(49).status, "custom");
  assert.equal(quote(50).standardUnitCents, 7500);
  assert.equal(quote(399).standardUnitCents, 7500);
  assert.equal(quote(400).standardUnitCents, 4000);
  assert.equal(quote(5000).standardUnitCents, 4000);
  assert.equal(quote(5001).standardUnitCents, 3500);
  assert.equal(quote(25000).standardUnitCents, 3500);
  assert.equal(quote(25001).standardUnitCents, 2700);
  assert.equal(quote(100000).standardUnitCents, 2700);
  assert.equal(quote(100001).status, "custom");
  assert.equal(quote(0).status, "invalid");
  assert.equal(quote(10.5).status, "invalid");
});

test("30% event pricing and totals", () => {
  assert.equal(quote(250).eventUnitCents, 5250);
  assert.equal(quote(1000).eventUnitCents, 2800);
  assert.equal(quote(10000).eventUnitCents, 2450);
  assert.equal(quote(50000).eventUnitCents, 1890);
  const q = quote(1000);
  assert.equal(q.standardTotalCents, 4_000_000);
  assert.equal(q.eventTotalCents, 2_800_000);
  assert.equal(q.savingsCents, 1_200_000);
});
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

import { orgKey, buildPage } from "../lib/notion.js";
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
  assert.equal(p.properties["Annual Contract Value"].number, 28000);
  assert.equal(p.properties["Event Price per Student"].number, 28);
  assert.equal(p.properties["Test Record"].checkbox, true);
  assert.match(p.properties.Name.title[0].text.content, /^\[TEST\] Sample USD$/);
});
