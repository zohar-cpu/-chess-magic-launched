import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { annualData, pilotData, generateDocument, loadTemplate, missingFields, manifest } from "../../lib/academy/documents.js";
import { reviewToken, verifyReviewToken, _setSqlForTests, audit, notionDocumentProps } from "../../lib/academy/doc-records.js";

process.env.NOTION_API_TOKEN ||= "test-token-for-hkdf-only";
const SRC = "templates/source/License Agreement - usa.docx";
const fict = { legalName: "Sample USD (FICTIONAL)", orgType: "School District", state: "Texas", registrationNo: "NCES 0", address: "1 Example St",
  fullName: "Taylor Sample", jobTitle: "CFO", email: "t@sample.example", phone: "555", reference: "LE26-X" };

test("manifest: templates are drafts, built from the recorded source file", () => {
  const m = manifest();
  assert.equal(m.approved, false);
  assert.match(m.status, /DRAFT/);
  const sha = (await_ => execFileSync("sha256sum", [SRC]).toString().split(" ")[0])();
  assert.equal(m.source.sha256, sha);
});

test("annual: progressive pricing from lib/pricing.js; first-year-only discount; renewal at standard", () => {
  const d = annualData({ ...fict, licenses: 6000, applyLaunchDiscount: true, licenseStart: "2027-07-01" }, { docId: "D", version: 1, draft: true });
  assert.deepEqual(d.bands.map((b) => [b.band_count, b.band_std_unit, b.band_fy_unit]), [["500", "$75.00", "$52.50"], ["4,500", "$30.00", "$21.00"], ["1,000", "$25.00", "$17.50"]]);
  assert.equal(d.std_total, "$197,500.00"); assert.equal(d.fy_total, "$138,250.00"); assert.equal(d.renewal_total, "$197,500.00");
  assert.match(d.discount_line, /^\$59,250\.00/); assert.match(d.renewal_line, /does not apply to any renewal/);
  assert.equal(d.license_end, "June 30, 2028");
  const s = annualData({ ...fict, licenses: 1000, applyLaunchDiscount: false }, { docId: "D", version: 1, draft: true });
  assert.equal(s.fy_total, "$52,500.00"); assert.equal(s.discount_label, "None");
  assert.throws(() => annualData({ ...fict, licenses: 49 }, {}), /custom-quote/);
  assert.throws(() => annualData({ ...fict, licenses: 100001 }, {}), /custom-quote/);
});

test("pilot: $0, quantity validated, no start date unless activated", () => {
  const d = pilotData({ ...fict, pilotStudents: 120 }, { docId: "P", version: 1, draft: true });
  assert.equal(d.pilot_students, "120"); assert.equal(d._period, null);
  assert.deepEqual(pilotData({ ...fict, pilotStudents: 5, activationDate: "2027-01-11" }, {})._period, { start: "2027-01-11", end: "2027-02-09" });
  assert.throws(() => pilotData({ ...fict, pilotStudents: 0 }, {}));
});

test("missing customer details are flagged, never invented", () => {
  const d = annualData({ licenses: 1000, applyLaunchDiscount: true }, { docId: "D", version: 1, draft: true });
  assert.deepEqual(missingFields(d).sort(), ["contact_email", "contact_name", "contact_phone", "contact_title", "customer_address", "customer_name", "customer_state", "customer_type", "license_end", "license_start", "payment_terms", "quote_reference", "registration_no"].sort());
});

test("tampered template is refused", () => {
  const p = "templates/pilot-order-form.docx", orig = fs.readFileSync(p);
  try { fs.writeFileSync(p, Buffer.concat([orig, Buffer.from(" ")])); assert.throws(() => loadTemplate("pilot"), /manifest hash/); }
  finally { fs.writeFileSync(p, orig); }
});

for (const [type, input] of [["annual", { ...fict, licenses: 1000, applyLaunchDiscount: true, licenseStart: "2027-07-01", paymentTerms: "Net 30" }],
                              ["pilot", { ...fict, pilotStudents: 120 }]]) {
  test(`${type}: generated PDF keeps License Terms + EULA identical to the source (XML and clause numbering)`, { timeout: 180000 }, async () => {
    const g = await generateDocument(type, input, { version: 2, docId: `T-${type}` });
    assert.equal(g.draft, true); assert.equal(g.version, 2); assert.equal(g.pdf.subarray(0, 4).toString(), "%PDF");
    fs.mkdirSync("/tmp/doctest", { recursive: true });
    fs.writeFileSync(`/tmp/doctest/${type}.docx`, g.docx); fs.writeFileSync(`/tmp/doctest/${type}.pdf`, g.pdf);
    if (!fs.existsSync("/tmp/doctest/source.pdf")) execFileSync("soffice", ["--headless", "--convert-to", "pdf", "--outdir", "/tmp/doctest", SRC]), fs.renameSync("/tmp/doctest/License Agreement - usa.pdf", "/tmp/doctest/source.pdf");
    const out = JSON.parse(execFileSync("python3", ["scripts/documents_qa.py", SRC, `/tmp/doctest/${type}.docx`, `/tmp/doctest/${type}.pdf`, "/tmp/doctest/source.pdf"]).toString());
    assert.equal(out.identical_xml, true); assert.equal(out.numbering_identical, true);
    const text = execFileSync("pdftotext", ["-layout", `/tmp/doctest/${type}.pdf`, "-"]).toString();
    assert.match(text, /NOT FOR SIGNATURE/); assert.match(text, /Signature fields are disabled/);
    if (type === "pilot") { assert.match(text, /\$0\.00/); assert.match(text, /No automatic conversion to paid licensing/); assert.match(text, /PILOT ADDENDUM/); assert.doesNotMatch(text, /\$52\.50/); }
    else { assert.match(text, /\$36,750\.00/); assert.match(text, /\$52,500\.00/); assert.match(text, /\$15,750\.00/); assert.doesNotMatch(text, /PILOT ADDENDUM/); }
    assert.doesNotMatch(text, /\{[#/]?[a-z_]+\}/, "no unfilled template tags");
  });
}

test("review links: signed, expiring, bound to the file hash", () => {
  const tok = reviewToken("CM-LO-1", 1, "a".repeat(64), Date.now() + 1000);
  assert.deepEqual(verifyReviewToken(tok).docId, "CM-LO-1");
  assert.equal(verifyReviewToken(tok + "x"), null);
  assert.equal(verifyReviewToken(reviewToken("CM-LO-1", 1, "a".repeat(64), Date.now() - 1)), null);
  const [p] = tok.split("."); assert.equal(verifyReviewToken(Buffer.from("CM-LO-2.1.aaaaaaaaaaaaaaaa." + (Date.now() + 1e6)).toString("base64url") + "." + tok.split(".")[1]), null);
});

test("audit trail: append-only events; unknown events refused; Notion gets metadata only", async () => {
  const rows = []; _setSqlForTests((s, ...v) => { if (/INSERT/.test(s.join(""))) rows.push(v); return Promise.resolve([]); });
  await audit({ docId: "D", version: 1, event: "generated", pdfSha256: "x" });
  await assert.rejects(audit({ docId: "D", version: 1, event: "signed" }), /Unknown event/);
  assert.equal(rows.length, 1);
  const props = notionDocumentProps({ docId: "D", version: 1, type: "annual", draft: true, templateVersion: "T", generatedAt: "2026-11-19T00:00:00Z", pdfSha256: "abc",
    quote: { licenses: 1000, standardTotalCents: 5250000, firstYearTotalCents: 3675000, savingsCents: 1575000, renewalAnnualCents: 5250000 } }, { orgPageId: "org" });
  assert.equal(props["Signature Status"].select.name, "Not enabled"); assert.equal(props["First-Year Total"].number, 36750);
  assert.ok(!JSON.stringify(props).includes("ip") || !JSON.stringify(props).match(/ip_hash|student/i));
});
