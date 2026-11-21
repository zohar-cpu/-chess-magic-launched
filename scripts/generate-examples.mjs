// Generates the two example PDFs (fictional customers) with the production generator.
import fs from "node:fs";
import { generateDocument } from "../lib/documents.js";
const out = process.argv[2] || "/home/claude/agreement/examples";
fs.mkdirSync(out, { recursive: true });
const pilot = await generateDocument("pilot", {
  reference: "PILOT-1A2B3C4D", legalName: "Lakeside Sample Charter Academy (FICTIONAL EXAMPLE)", registrationNo: "EIN 00-0000000 (fictional)",
  address: "100 Example Way, Orlando, FL 32801 (fictional)", fullName: "Jordan Example", jobTitle: "Principal",
  email: "jordan.example@lakeside-sample.example", phone: "(555) 010-0100", pilotStudents: 120, pilotTeachers: 6,
}, { version: 1, docId: "CM-PO-20261119-EXAMPLE" });
const annual = await generateDocument("annual", {
  reference: "LE26-9F8E7D6C", legalName: "Riverbend Sample Unified School District (FICTIONAL EXAMPLE)", orgType: "School District", state: "California",
  registrationNo: "NCES ID 0000000 (fictional)", address: "200 Sample Avenue, Riverbend, CA 90000 (fictional)", fullName: "Taylor Sample",
  jobTitle: "Chief Business Officer", email: "tsample@riverbend-sample.example", phone: "(555) 010-0200", licenses: 6000,
  applyLaunchDiscount: true, licenseStart: "2027-07-01", paymentTerms: "Net 30 days from invoice; purchase order number required on invoices [PROPOSED: business and counsel to confirm]",
}, { version: 1, docId: "CM-LO-20261119-EXAMPLE" });
for (const [n, g] of [["Example-Pilot-Order-Form", pilot], ["Example-Annual-License-Order-Form", annual]]) {
  fs.writeFileSync(`${out}/${n}.pdf`, g.pdf); fs.writeFileSync(`${out}/${n}.docx`, g.docx);
  console.log(n, { draft: g.draft, pdfSha256: g.pdfSha256.slice(0, 16), missing: g.missing, firstYear: g.quote?.firstYearTotalCents });
}
