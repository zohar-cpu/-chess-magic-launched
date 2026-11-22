// Free 30-Day Pilot request → Notion (Business Partners Dashboard), ONE record per request.
// Uses ONLY columns that already exist in the live dashboard. Pilot details and the consent proof
// (exact wording shown, document versions, time) are written in the record's page body.
// A pilot request is non-binding: it creates no license, no student account and no signature.
//
// Duplicate rules (pilot records only = Lead Source "ChessMagic Academy Launch" + reference "PILOT-…",
// test and live kept apart):
//  - same Submission ID                 → "retry": the same submit arrived twice → return the original
//  - same contact email + same org name  → "duplicate": nothing new is created; a dated note is appended
//  - a colleague from the same org       → new record, flagged "possible duplicate" for staff review
// Existing records are never overwritten.
import { notion, plain, rt, callout, bullet, orgKey, ACADEMY_SOURCE } from "./notion.js";

const env = (k) => (process.env[k] || "").trim();
export const pilotCrmConfigured = () => !!(env("NOTION_API_TOKEN") && env("NOTION_DATA_SOURCE_ID"));
export const PILOT_REF_PREFIX = "PILOT-";

async function queryAll(filter) {
  const out = []; let cursor;
  do {
    const r = await notion(`/data_sources/${env("NOTION_DATA_SOURCE_ID")}/query`, "POST", { filter, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
    out.push(...(r.results || [])); cursor = r.has_more ? r.next_cursor : undefined;
  } while (cursor);
  return out;
}

const heading = (s) => ({ object: "block", type: "heading_3", heading_3: { rich_text: rt(s) } });

/** consent: { termsName, termsVersion, termsText, privacyName, privacyVersion, privacyUrl, privacyText, authorityText, marketingText, at } */
export async function savePilotRequest(p, reference, consent) {
  const pilots = await queryAll({ and: [
    { property: "Lead Source", select: { equals: ACADEMY_SOURCE } },
    { property: "LaunchEd Reference", rich_text: { starts_with: PILOT_REF_PREFIX } },
    { property: "Test Record", checkbox: { equals: !!p.isTest } },
  ] });
  const key = orgKey(p.orgName);
  const nameOf = (c) => orgKey(plain(c.properties?.Name?.title).replace(/^\[TEST\]\s*/, ""));
  const retry = pilots.find((c) => plain(c.properties?.["Submission ID"]?.rich_text) === p.submissionId);
  if (retry) return { kind: "retry", pageId: retry.id, url: retry.url, reference: plain(retry.properties?.["LaunchEd Reference"]?.rich_text) };
  const dup = pilots.find((c) => (c.properties?.["Contact Email"]?.email || "").toLowerCase() === p.email && nameOf(c) === key);
  if (dup) {
    await notion(`/blocks/${dup.id}/children`, "PATCH", { children: [callout(`Repeat pilot request from the same contact on ${new Date().toISOString().slice(0, 10)} (~${p.pilotStudents} students). No fields were changed.`, "🔁")] });
    return { kind: "duplicate", pageId: dup.id, url: dup.url, reference: plain(dup.properties?.["LaunchEd Reference"]?.rich_text) };
  }
  const colleagues = pilots.filter((c) => nameOf(c) === key && c.properties?.State?.select?.name === p.state);
  const page = await notion("/pages", "POST", {
    parent: { type: "data_source_id", data_source_id: env("NOTION_DATA_SOURCE_ID") },
    properties: {
      Name: { title: rt(`${p.isTest ? "[TEST] " : ""}${p.orgName}`) },
      "Lead Source": { select: { name: ACADEMY_SOURCE } },
      "Sales Status": { status: { name: "Not started" } },
      "Type of person": { multi_select: [{ name: "Customer" }] },
      Region: { multi_select: [{ name: "US" }] },
      Department: { multi_select: [{ name: "Sales" }] },
      "Contact Name": { rich_text: rt(p.fullName) },
      "Contact Email": { email: p.email },
      "Job Title": { rich_text: rt(p.jobTitle) },
      State: { select: { name: p.state } },
      "Agreement Status": { select: { name: "Not sent" } },
      "Submission ID": { rich_text: rt(p.submissionId) },
      "LaunchEd Reference": { rich_text: rt(reference) },
      "Submitted At": { date: { start: consent.at } },
      "Test Record": { checkbox: !!p.isTest },
    },
    children: [
      ...(p.isTest ? [callout("TEST RECORD: created to verify the pilot request flow. Not a real lead; safe to delete.", "🧪")] : []),
      ...(colleagues.length ? [callout(`Another contact from the same organization already requested a pilot (${colleagues.map((c) => c.url).join(", ")}). Please review together.`, "👥")] : []),
      callout("FREE 30-DAY PILOT REQUEST (non-binding). No license, purchase or signature. Do NOT create or activate student accounts until the school's approvals are received, any required student data protection agreement is signed, and a Pilot Order Form is signed. The 30 days begin only on activation.", "🔒"),
      heading("Pilot request"),
      bullet(`Estimated students: ${p.pilotStudents}`),
      bullet(`Marketing emails: ${p.marketing ? "opted in" : "not opted in"}`),
      bullet(`Reference: ${reference}`),
      heading("Acknowledgments recorded at submission"),
      bullet(`Time (UTC): ${consent.at}`),
      bullet(`${consent.termsName} (${consent.termsVersion}): "${consent.termsText}"`),
      bullet(`${consent.privacyName} (${consent.privacyVersion}, ${consent.privacyUrl}): "${consent.privacyText}"`),
      bullet(`Authority: "${consent.authorityText}"`),
      ...(p.marketing ? [bullet(`Marketing: "${consent.marketingText}"`)] : []),
    ],
  });
  return { kind: "created", pageId: page.id, url: page.url, reference, colleagues: colleagues.length };
}
