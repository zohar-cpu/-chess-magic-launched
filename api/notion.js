// Notion CRM adapter (server-side only) for the Business Partners Dashboard.
// Database ID:    3feba0a2-da2c-8059-b729-cd201e71fab7  (NOT used for writes)
// Data source ID: 3feba0a2-da2c-80b0-bcbf-000bc124678e  (NOTION_DATA_SOURCE_ID)
//
// Safety rules enforced here:
//  - Registration only ever CREATES a new page.
//  - Follow-up actions touch only the LaunchEd page created for that same
//    submission (HMAC token + Lead Source check) and only fill EMPTY fields;
//    anything else is appended as a note, never overwritten.
//  - Pre-existing (non-LaunchEd) records are never modified.
//  - Only existing select/status options are written.
import crypto from "node:crypto";
import { usd, DISCOUNT_PCT } from "./pricing.js";

const API = "https://api.notion.com/v1";
const NOTION_VERSION = "2025-09-03"; // data-source-aware API version
export const LEAD_SOURCE = "LaunchEd Showcase 2026";
const TEST_PREFIX = "[TEST] ";

export const SALES = { new: "Not started", agreementSent: "Proposal sent", signed: "Done WIN" };
export const AGREEMENT = { notSent: "Not sent", pending: "Pending (sales to send)", sent: "Sent for signature", signed: "Signed", declined: "Declined" };
export const PATH = { sign_review: "Review & Sign", request_offer: "Request Exclusive Offer" };

const env = (k) => (process.env[k] || "").trim();
// Only two settings are required. The signing key for visitors' follow-up links is
// DERIVED from the Notion token with HKDF-SHA256 (RFC 5869), so no extra secret has to
// be generated or handled by hand. It never leaves the server. An explicit
// LAUNCHED_ACTION_SECRET, if ever set, takes precedence.
export const notionConfigured = () => !!(env("NOTION_API_TOKEN") && env("NOTION_DATA_SOURCE_ID"));
function actionKey() {
  const explicit = env("LAUNCHED_ACTION_SECRET");
  if (explicit) return Buffer.from(explicit);
  return Buffer.from(crypto.hkdfSync("sha256", env("NOTION_API_TOKEN"), "chess-magic-launched-2026", "visitor-action-token-v1", 32));
}

async function notion(path, method = "GET", body) {
  const r = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${env("NOTION_API_TOKEN")}`, "Notion-Version": NOTION_VERSION, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(`Notion ${method} ${path.split("?")[0]} failed (${r.status} ${j.code || ""}: ${j.message || ""})`);
    err.status = r.status; err.code = j.code;
    throw err;
  }
  return j;
}

/** Per-record capability token so a visitor can only add follow-up details to their own record. */
export function actionToken(pageId) {
  return crypto.createHmac("sha256", actionKey()).update(String(pageId).replace(/-/g, "")).digest("hex");
}
export function verifyActionToken(pageId, token) {
  const a = Buffer.from(actionToken(pageId)), b = Buffer.from(String(token));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Normalized organization key. */
export function orgKey(name) {
  return String(name || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").replace(/\b(the|inc|llc|corp|co)\b/g, " ")
    .replace(/\s+/g, " ").trim();
}

const plain = (rt) => (rt || []).map((x) => x.plain_text || "").join("");
const rt = (s) => [{ type: "text", text: { content: String(s ?? "").slice(0, 1900) } }];

/**
 * Duplicate check among LaunchEd records only (test and live kept apart):
 *  - same Submission ID         → "retry"     (same visitor, same submit; idempotent)
 *  - same contact email + org   → "duplicate" (same person registering again)
 * A different contact from the same organization is NOT a duplicate.
 */
export async function findExisting(lead) {
  const key = orgKey(lead.orgName);
  let cursor;
  do {
    const res = await notion(`/data_sources/${env("NOTION_DATA_SOURCE_ID")}/query`, "POST", {
      filter: { and: [
        { property: "Lead Source", select: { equals: LEAD_SOURCE } },
        { property: "Test Record", checkbox: { equals: !!lead.isTest } },
        { or: [
          { property: "Submission ID", rich_text: { equals: lead.submissionId } },
          { property: "Contact Email", email: { equals: lead.email } },
        ] },
      ] },
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    for (const p of res.results || []) {
      const pr = p.properties || {};
      const ref = plain(pr["LaunchEd Reference"]?.rich_text);
      if (plain(pr["Submission ID"]?.rich_text) === lead.submissionId) return { kind: "retry", pageId: p.id, url: p.url, reference: ref };
      const sameEmail = (pr["Contact Email"]?.email || "").toLowerCase() === lead.email;
      const sameOrg = orgKey(plain(pr.Name?.title).replace(TEST_PREFIX, "")) === key;
      if (sameEmail && sameOrg) return { kind: "duplicate", pageId: p.id, url: p.url, reference: ref };
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return null;
}

const callout = (s, emoji) => ({ object: "block", type: "callout", callout: { rich_text: rt(s), icon: { type: "emoji", emoji } } });
const bullet = (s) => ({ object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: rt(s) } });

export function buildPage(lead, q, { reference }) {
  const ok = q.status === "ok";
  const dollars = (c) => Math.round(c) / 100;
  return {
    parent: { type: "data_source_id", data_source_id: env("NOTION_DATA_SOURCE_ID") },
    properties: {
      Name: { title: rt(`${lead.isTest ? TEST_PREFIX : ""}${lead.orgName}`) },
      "Lead Source": { select: { name: LEAD_SOURCE } },
      "Sales Status": { status: { name: SALES.new } },
      "Type of person": { multi_select: [{ name: "Customer" }] },
      Region: { multi_select: [{ name: "US" }] },
      Department: { multi_select: [{ name: "Sales" }] },
      "Contact Name": { rich_text: rt(lead.fullName) },
      "Contact Email": { email: lead.email },
      ...(lead.phone ? { "Contact Phone": { phone_number: lead.phone } } : {}),
      "Job Title": { rich_text: rt(lead.jobTitle) },
      "Organization Type": { select: { name: lead.orgType } },
      State: { select: { name: lead.state } },
      "Student Licenses": { number: lead.licenses },
      "LaunchEd Discount": { number: DISCOUNT_PCT / 100 },
      ...(ok ? {
        "Standard Price per Student": { number: dollars(q.standardUnitCents) },
        "Event Price per Student": { number: dollars(q.eventUnitCents) },
        "Annual Contract Value": { number: dollars(q.eventTotalCents) },
        "Annual Savings": { number: dollars(q.savingsCents) },
      } : {}),
      "Agreement Status": { select: { name: AGREEMENT.notSent } },
      "Submission ID": { rich_text: rt(lead.submissionId) },
      "LaunchEd Reference": { rich_text: rt(reference) },
      "Submitted At": { date: { start: new Date().toISOString() } },
      "Test Record": { checkbox: !!lead.isTest },
    },
    children: [
      ...(lead.isTest ? [callout("TEST RECORD: created to verify the LaunchEd integration. Not a real lead; safe to delete.", "🧪")] : []),
      ok
        ? bullet(`${lead.licenses.toLocaleString("en-US")} licenses × ${usd(q.eventUnitCents)} (standard ${usd(q.standardUnitCents)}, tier ${q.tier}, ${DISCOUNT_PCT}% LaunchEd discount) = ${usd(q.eventTotalCents)} / year, excl. taxes.`)
        : bullet(`${lead.licenses.toLocaleString("en-US")} licenses: outside listed tiers. CUSTOM PRICING REQUIRED; no automatic offer.`),
      ...(Object.keys(lead.utm || {}).length ? [bullet(`UTM: ${JSON.stringify(lead.utm)}`)] : []),
    ],
  };
}

export async function createLeadPage(lead, q, opts) {
  const page = await notion("/pages", "POST", buildPage(lead, q, opts));
  return { pageId: page.id, url: page.url };
}

/** Loads a LaunchEd page; throws if it is not one this integration created. */
export async function getLaunchEdPage(pageId) {
  const page = await notion(`/pages/${encodeURIComponent(pageId)}`);
  if (page.properties?.["Lead Source"]?.select?.name !== LEAD_SOURCE) {
    const e = new Error("Not a LaunchEd record."); e.status = 403; throw e;
  }
  return page;
}

/**
 * Applies a visitor's Option A/B choice WITHOUT overwriting: properties are set
 * only where currently empty; the full request is always appended as a note.
 */
export async function recordVisitorAction(page, a) {
  const pr = page.properties || {};
  const isEmpty = (p) => {
    if (!p) return true;
    switch (p.type) {
      case "select": return !p.select;
      case "rich_text": return !plain(p.rich_text);
      case "email": return !p.email;
      default: return false;
    }
  };
  const set = {};
  const put = (name, value) => { if (isEmpty(pr[name])) set[name] = value; };
  let note;
  if (a.action === "sign_review") {
    put("LaunchEd Path", { select: { name: PATH.sign_review } });
    if (pr["Agreement Status"]?.select?.name === AGREEMENT.notSent || !pr["Agreement Status"]?.select) {
      set["Agreement Status"] = { select: { name: AGREEMENT.pending } }; // advance from "Not sent" only
    }
    note = callout(`Option A: reviewed the DRAFT Order Form and confirmed signing authority (${new Date().toISOString()}). E-signature not yet enabled; sales to prepare the agreement once legal approval is complete.`, "✍️");
  } else {
    put("LaunchEd Path", { select: { name: PATH.request_offer } });
    put("Follow-up Method", { select: { name: a.method } });
    put("Preferred Follow-up Time", { rich_text: rt(a.preferredTime) });
    if (a.ccEmail) { put("Representative Name", { rich_text: rt(a.ccName) }); put("Representative Email", { email: a.ccEmail }); }
    note = callout(`Option B: requested exclusive offer (${new Date().toISOString()}). Follow-up: ${a.method}, ${a.preferredTime}.${a.ccEmail ? ` Also send to ${a.ccName} <${a.ccEmail}>.` : ""}${a.notes ? ` Notes: ${a.notes}` : ""}`, "📌");
  }
  if (Object.keys(set).length) await notion(`/pages/${encodeURIComponent(page.id)}`, "PATCH", { properties: set });
  await notion(`/blocks/${encodeURIComponent(page.id)}/children`, "PATCH", { children: [note] });
}

/** Status updates from the e-sign webhook (LaunchEd records only). */
export async function updateLaunchEdRecord(pageId, { salesStatus, agreementStatus, note }) {
  await getLaunchEdPage(pageId);
  const properties = {};
  if (salesStatus) properties["Sales Status"] = { status: { name: salesStatus } };
  if (agreementStatus) properties["Agreement Status"] = { select: { name: agreementStatus } };
  await notion(`/pages/${encodeURIComponent(pageId)}`, "PATCH", { properties });
  if (note) await notion(`/blocks/${encodeURIComponent(pageId)}/children`, "PATCH", { children: [callout(note, "✅")] });
}

/** Read-only connection + schema check (scripts/notion-check.mjs). */
export async function checkSchema() {
  const ds = await notion(`/data_sources/${env("NOTION_DATA_SOURCE_ID")}`);
  const props = ds.properties || {};
  const problems = [];
  const expect = {
    Name: "title", "Lead Source": "select", "Sales Status": "status", "Type of person": "multi_select",
    Region: "multi_select", Department: "multi_select", "Contact Name": "rich_text", "Contact Email": "email",
    "Contact Phone": "phone_number", "Job Title": "rich_text", "Organization Type": "select", State: "select",
    "Student Licenses": "number", "LaunchEd Discount": "number", "Standard Price per Student": "number",
    "Event Price per Student": "number", "Annual Contract Value": "number", "Annual Savings": "number",
    "LaunchEd Path": "select", "Agreement Status": "select", "Follow-up Method": "select",
    "Preferred Follow-up Time": "rich_text", "Representative Name": "rich_text", "Representative Email": "email",
    "Submission ID": "rich_text", "LaunchEd Reference": "rich_text", "Submitted At": "date", "Test Record": "checkbox",
  };
  for (const [n, type] of Object.entries(expect)) if (props[n]?.type !== type) problems.push(`"${n}" should be ${type}, found ${props[n]?.type || "missing"}`);
  const opts = (n) => (props[n]?.[props[n]?.type]?.options || []).map((o) => o.name);
  const need = (n, values) => values.forEach((v) => { if (!opts(n).includes(v)) problems.push(`"${n}" option "${v}" missing`); });
  need("Sales Status", Object.values(SALES)); need("Agreement Status", Object.values(AGREEMENT));
  need("LaunchEd Path", Object.values(PATH)); need("Lead Source", [LEAD_SOURCE]);
  need("Follow-up Method", ["Zoom call", "Phone call", "Email"]);
  need("Type of person", ["Customer"]); need("Region", ["US"]); need("Department", ["Sales"]);
  need("Organization Type", ["School District", "Charter School", "Charter School Network"]);
  return { title: plain(ds.title), problems };
}
