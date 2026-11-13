// Sends ONE clearly marked test registration (+ an Option B request) through the real deployed API.
// Usage: LAUNCHED_TEST_KEY=... node scripts/send-test-lead.mjs https://YOUR-DEPLOYMENT
import crypto from "node:crypto";
const base = process.argv[2], key = process.env.LAUNCHED_TEST_KEY;
if (!base || !key) { console.error("Usage: LAUNCHED_TEST_KEY=... node scripts/send-test-lead.mjs https://your-deployment"); process.exit(1); }
const post = async (path, body) => {
  const r = await fetch(new URL(path, base), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({})); console.log(path, `HTTP ${r.status}`, JSON.stringify(j)); return { r, j };
};
const reg = await post("/api/leads", {
  submissionId: crypto.randomUUID(), fullName: "Test Contact (Chess Magic QA)", email: "launched-test@example.org",
  jobTitle: "QA Test (not a real lead)", orgName: "Chess Magic Integration Test District", orgType: "School District",
  state: "Florida", licenses: 1000, phone: null, consent: true, website: "", utm: { utm_source: "integration-test" }, testKey: key,
});
if (!reg.r.ok || reg.j.ok !== true) process.exit(1);
if (reg.j.status !== "registered") { console.log("Not created:", reg.j.status); process.exit(0); }
const b = await post("/api/lead-action", { action: "request_offer", pageId: reg.j.pageId, token: reg.j.token, method: "Email", preferredTime: "Integration test, no follow-up needed" });
process.exit(b.r.ok && b.j.ok ? 0 : 1);
