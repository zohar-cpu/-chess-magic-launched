import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { validatePilot } from "../../lib/academy/validate-pilot.js";
import { LEGAL, CONSENT_TEXT, pilotRegistrationOpen } from "../../lib/academy/legal.js";

const good = () => ({
  submissionId: "pilot-test-0001", orgName: "Lincoln Elementary", fullName: "Dana Rivera", email: "dana@lincoln.k12.tx.us",
  jobTitle: "Principal", state: "Texas", pilotStudents: 120,
  consents: { terms: true, privacy: true, authority: true, marketing: false, termsVersion: LEGAL.terms.version, privacyVersion: LEGAL.privacy.version },
});

test("pilot: valid request with exactly the six fields", () => {
  const r = validatePilot(good()); assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.pilot).sort(), ["email","fullName","jobTitle","marketing","orgName","pilotStudents","state","submissionId"].sort());
});
test("pilot: each mandatory acknowledgment is required (must be literally true)", () => {
  for (const k of ["terms", "privacy", "authority"]) {
    const b = good(); b.consents[k] = false; assert.equal(validatePilot(b).ok, false, k);
    const c = good(); c.consents[k] = "true"; assert.equal(validatePilot(c).ok, false, k + " string");
  }
});
test("pilot: marketing consent is optional", () => {
  const b = good(); delete b.consents.marketing; assert.equal(validatePilot(b).ok, true);
  const m = good(); m.consents.marketing = true; assert.equal(validatePilot(m).pilot.marketing, true);
});
test("pilot: stale document versions are rejected", () => {
  const b = good(); b.consents.termsVersion = "OLD"; assert.equal(validatePilot(b).ok, false);
});
test("pilot: student data fields are refused", () => {
  const b = good(); b.studentNames = ["A B"]; assert.equal(validatePilot(b).ok, false);
});
test("pilot: personal email domains refused", () => {
  const b = good(); b.email = "dana@gmail.com"; assert.equal(validatePilot(b).ok, false);
});
test("release gate: pilot requests open only when PILOT_REGISTRATION_OPEN=true", () => {
  delete process.env.PILOT_REGISTRATION_OPEN;
  assert.equal(pilotRegistrationOpen(), false);
  process.env.PILOT_REGISTRATION_OPEN = "true";
  assert.equal(/DRAFT/.test(LEGAL.terms.version + LEGAL.privacy.version), false);
  assert.equal(pilotRegistrationOpen(), true);
  delete process.env.PILOT_REGISTRATION_OPEN;
});
test("page shows exactly the consent text the server records", () => {
  const html = fs.readFileSync(new URL("../../public/academy.html", import.meta.url), "utf8");
  for (const k of ["terms", "privacy", "authority", "marketing"]) {
    const m = html.match(new RegExp(`data-consent="${k}">([\\s\\S]*?)</span></label>`));
    assert.ok(m, k);
    const text = m[1].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<");
    assert.equal(text, CONSENT_TEXT[k], k);
  }
  // checkboxes are unchecked by default
  for (const id of ["cTerms", "cPrivacy", "cAuth", "cMarketing"]) assert.doesNotMatch(html, new RegExp(`id="${id}"[^>]*checked`));
});

import { activationCheck, pilotPeriod, studentActivationEnabled, SUBMISSION_STATE } from "../../lib/academy/pilot-lifecycle.js";
test("pilot lifecycle: 30 days start on activation, never on submission", () => {
  assert.deepEqual(pilotPeriod("2027-01-04"), { start: "2027-01-04", end: "2027-02-02" });
  assert.deepEqual(pilotPeriod("2027-02-15"), { start: "2027-02-15", end: "2027-03-16" });
  assert.equal(SUBMISSION_STATE.pilotStartDate, null);
  assert.equal(SUBMISSION_STATE.pilotStatus, "Pilot Requested");
});
test("activation gate: hard-locked in code, and needs school approval + DPA", () => {
  const ready = { schoolApproval: "Received", dpaStatus: "Signed", pilotStatus: "Pilot Approved", pilotStartDate: null };
  process.env.STUDENT_ACTIVATION_ENABLED = "true"; process.env.PILOT_REGISTRATION_OPEN = "true";
  assert.equal(studentActivationEnabled(), false, "activation stays off even when every setting is on");
  delete process.env.PILOT_REGISTRATION_OPEN;
  assert.equal(activationCheck(ready).ready, false);
  delete process.env.STUDENT_ACTIVATION_ENABLED;
  const miss = activationCheck({ schoolApproval: "Not received", dpaStatus: "To be determined", pilotStatus: "Pilot Requested" }).missing;
  assert.equal(miss.length, 4);
});

import { pilotConfirmation, quoteConfirmation } from "../../lib/academy/email.js";
import { quote as q2 } from "../../lib/academy/pricing.js";
test("confirmation emails: references, next steps, no commitment, no student data", () => {
  const p = { fullName: "Dana Rivera", orgName: "Lincoln Elementary", state: "Texas", pilotStudents: 120, email: "dana@lincoln.k12.tx.us" };
  const e = pilotConfirmation(p, "PILOT-ABCD1234");
  assert.match(e.subject, /PILOT-ABCD1234/); assert.match(e.text, /30 days begin on that day/); assert.match(e.text, /no annual license commitment/);
  assert.match(e.text, /No student accounts have been created/);
  const q = quoteConfirmation({ fullName: "Sam", orgName: "Riverside USD", email: "s@r.org", licenses: 1000 }, q2(1000), "LE26-1", { endsDate: "2026-12-30", status: "active" });
  assert.match(q.text, /Students 1–500: 500 × \$52\.50 = \$26,250\.00/);
  assert.match(q.text, /Students 501–1,000: 500 × \$21\.00 = \$10,500\.00/);
  assert.match(q.text, /First-year total: \$36,750\.00 \(standard \$52,500\.00; you save \$15,750\.00\)/);
  assert.match(q.text, /renew at the standard annual price \(\$52,500\.00/);
  assert.match(q.text, /December 30, 2026/); assert.match(q.text, /not a binding offer/);
});

import { orderFormDraftHTML } from "../../lib/academy/order-form.js";
test("draft Order Form: marginal schedule, first-year-only discount, signatures disabled", () => {
  const h = orderFormDraftHTML({ orgName: "Riverside USD", orgType: "School District", state: "California", fullName: "Sam Patel", jobTitle: "CFO", email: "s@r.org", licenses: 6000 },
    { reference: "LE26-X", window: { launchDate: "2026-12-01", endsDate: "2026-12-30" } });
  assert.match(h, /NOT FOR SIGNATURE/); assert.match(h, /SIGNATURE DISABLED/); assert.doesNotMatch(h, /<input|<button/);
  assert.match(h, /Each rate applies only to the student licenses that fall within its band/);
  // 6,000: 500×75 + 4,500×30 + 1,000×25 = 37,500 + 135,000 + 25,000 = 197,500 ; first year ×0.7 = 138,250
  assert.match(h, /\$197,500\.00/); assert.match(h, /\$138,250\.00/); assert.match(h, /first contract year only/);
});
