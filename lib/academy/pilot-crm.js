// Free 30-Day Pilot → Notion (Business Partners Dashboard), ONE record per request, like the
// Showcase registrations. No separate contacts database. No student data and no consent wording in
// Notion: only a Consent Reference pointing to the private consent record.
//
// Duplicate rules (pilot records only, test and live kept apart):
//  - same Submission ID                 → "retry": the same submit arrived twice → return the original
//  - same contact email + same org name  → "duplicate": nothing new is created; a dated note is appended
//  - a colleague from the same org       → new record, flagged "possible duplicate" for staff review
// Existing records are never overwritten.
import { notion, plain, rt, callout, orgKey, CAMPAIGN_OPTION, ACADEMY_SOURCE, PILOT_STATUS } from "./notion.js";

const env = (k) => (process.env[k] || "").trim();
export const pilotCrmConfigured = () => !!(env("NOTION_API_TOKEN") && env("NOTION_DATA_SOURCE_ID"));

async function queryAll(filter) {
  const out = []; let cursor;
  do {
    const r = await notion(`/data_sources/${env("NOTION_DATA_SOURCE_ID")}/query`, "POST", { filter, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
    out.push(...(r.results || [])); cursor = r.has_more ? r.next_cursor : undefined;
  } while (cursor);
  return out;
}

export async function savePilotRequest(p, reference) {
  const pilots = await queryAll({ and: [
    { property: "Lead Source", select: { equals: ACADEMY_SOURCE } },
    { property: "Campaign Option", select: { equals: CAMPAIGN_OPTION.pilot } },
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
      "Campaign Option": { select: { name: CAMPAIGN_OPTION.pilot } },
      "Sales Status": { status: { name: "Not started" } },
      "Type of person": { multi_select: [{ name: "Customer" }] },
      Region: { multi_select: [{ name: "US" }] },
      Department: { multi_select: [{ name: "Sales" }] },
      "Contact Name": { rich_text: rt(p.fullName) },
      "Contact Email": { email: p.email },
      "Job Title": { rich_text: rt(p.jobTitle) },
      State: { select: { name: p.state } },
      "Submission ID": { rich_text: rt(p.submissionId) },
      "LaunchEd Reference": { rich_text: rt(reference) },
      "Submitted At": { date: { start: new Date().toISOString() } },
      "Test Record": { checkbox: !!p.isTest },
      "Pilot Status": { select: { name: PILOT_STATUS[0] } },
      "Pilot Students": { number: p.pilotStudents },
      "School Approval": { select: { name: "Not received" } },
      "DPA Status": { select: { name: "To be determined" } },
      "Consent Reference": { rich_text: rt(reference) },
      "Marketing Opt-in": { checkbox: !!p.marketing },
      // "Pilot Start Date" is deliberately NOT set here: the 30 days begin only on activation.
    },
    children: [
      ...(p.isTest ? [callout("TEST RECORD: created to verify the pilot flow. Not a real lead; safe to delete.", "🧪")] : []),
      ...(colleagues.length ? [callout(`Another contact from the same organization already requested a pilot (${colleagues.map((c) => c.url).join(", ")}). Please review together.`, "👥")] : []),
      callout("Free 30-Day Pilot requested. Student accounts must NOT be activated until School Approval = Received AND DPA Status = Signed or Not required (confirmed by school). Set Pilot Start Date only on the day access is activated.", "🔒"),
    ],
  });
  return { kind: "created", pageId: page.id, url: page.url, reference, colleagues: colleagues.length };
}
