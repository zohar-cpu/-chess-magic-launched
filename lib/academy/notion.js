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
import { usd, int, DISCOUNT_PCT } from "./pricing.js";
import { targetSchema } from "./crm-schema.js";

const API = "https://api.notion.com/v1";
const NOTION_VERSION = "2025-09-03"; // data-source-aware API version
export const LEAD_SOURCE = "LaunchEd Showcase 2026";            // original Showcase site
export const ACADEMY_SOURCE = "ChessMagic Academy Launch";         // Academy B2B launch campaign
export const LEAD_SOURCES = [LEAD_SOURCE, ACADEMY_SOURCE];
export const CAMPAIGN_OPTION = { pilot: "Free 30-Day Pilot", offer: "30% Launch Offer" };
export const PILOT_STATUS = ["Pilot Requested", "Pending School / Privacy Approval", "Pilot Approved", "Pilot Active", "Pilot Completed", "Converted to Paid"];
export const sourceFor = (lead) => (lead.campaign === "academy-2026" ? ACADEMY_SOURCE : LEAD_SOURCE);
const TEST_PREFIX = "[TEST] ";

export const SALES = { new: "Not started", agreementSent: "Proposal sent", signed: "Done WIN" };
export const AGREEMENT = { notSent: "Not sent", pending: "Pending (sales to send)", sent: "Sent for signature", signed: "Signed", declined: "Declined" };
export const PATH = { sign_review: "Review & Sign", request_offer: "Request Exclusive Offer" };
export const ACADEMY_PATH = { sign_review: "Review & Sign", request_offer: "Schedule a Call", schedule_call: "Schedule a Call" };

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

export async function notion(path, method = "GET", body) {
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

export const plain = (rt) => (rt || []).map((x) => x.plain_text || "").join("");
export const rt = (s) => [{ type: "text", text: { content: String(s ?? "").slice(0, 1900) } }];

/**
 * Duplicate check among LaunchEd records only (test and live kept apart):
 *  - same Submission ID         → "retry"     (same visitor, same submit; idempotent)
 *  - same contact email + org   → "duplicate" (same person registering again)
 * A different contact from the same organization is NOT a duplicate.
 * Academy campaign: checked per option, so one person can request a pilot AND a quote.
 */
export async function findExisting(lead) {
  const key = orgKey(lead.orgName);
  let cursor;
  do {
    const res = await notion(`/data_sources/${env("NOTION_DATA_SOURCE_ID")}/query`, "POST", {
      filter: { and: [
        { property: "Lead Source", select: { equals: sourceFor(lead) } },
        { property: "Test Record", checkbox: { equals: !!lead.isTest } },
        // Academy quotes are told apart from pilot requests by their reference prefix (no extra column needed).
        ...(lead.campaign === "academy-2026" ? [{ property: "LaunchEd Reference", rich_text: { starts_with: "QUOTE-" } }] : []),
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

export const callout = (s, emoji) => ({ object: "block", type: "callout", callout: { rich_text: rt(s), icon: { type: "emoji", emoji } } });
export const bullet = (s) => ({ object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: rt(s) } });

export function buildPage(lead, q, { reference }) {
  const academy = lead.campaign === "academy-2026";
  const ok = !!(q && q.status === "ok");
  const dollars = (c) => Math.round(c) / 100;
  const properties = {
    Name: { title: rt(`${lead.isTest ? TEST_PREFIX : ""}${lead.orgName}`) },
    "Lead Source": { select: { name: sourceFor(lead) } },
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
    "Submission ID": { rich_text: rt(lead.submissionId) },
    "LaunchEd Reference": { rich_text: rt(reference) },
    "Submitted At": { date: { start: new Date().toISOString() } },
    "Test Record": { checkbox: !!lead.isTest },
  };
  let summary;
  {
    Object.assign(properties, {
      "Student Licenses": { number: lead.licenses },
      ...(ok && q.discountApplied ? { "LaunchEd Discount": { number: DISCOUNT_PCT / 100 } } : {}),
      ...(ok ? {
        // Marginal pricing: per-student values are blended averages across the bands.
        "Standard Price per Student": { number: dollars(q.avgStandardCents) },
        "Event Price per Student": { number: dollars(q.avgFirstYearCents) },
        "Annual Contract Value": { number: dollars(q.firstYearTotalCents) },
        "Annual Savings": { number: dollars(q.savingsCents) },
      } : {}),
      "Agreement Status": { select: { name: AGREEMENT.notSent } },
    });
    summary = ok
      ? [bullet(`${int(lead.licenses)} student licenses, progressive (marginal) tiers${q.discountApplied ? `, ${DISCOUNT_PCT}% first-year launch discount on every tier` : ", standard pricing (launch offer not active at submission)"}:`),
         ...q.bands.map((b) => bullet(`   Students ${int(b.from)}–${int(b.to)}: ${int(b.count)} × ${usd(b.firstYearUnitCents)}${q.discountApplied ? ` (standard ${usd(b.standardUnitCents)})` : ""} = ${usd(b.firstYearCents)}`)),
         bullet(`First-year total ${usd(q.firstYearTotalCents)} · standard ${usd(q.standardTotalCents)} · savings ${usd(q.savingsCents)} · renewal (year 2+) at standard rates: ${usd(q.renewalAnnualCents)} per year. USD, excluding taxes.`),
         ...(academy ? [bullet(`30% Launch Offer quote request${lead.offerEnds && q.discountApplied ? ` · offer valid until ${lead.offerEnds}` : ""}`),
                        callout("Quote request only (non-binding). Not a purchase or signed agreement. Prepare a formal quote; any order requires a signed Order Form.", "📌")] : [])]
      : [bullet(`${int(lead.licenses)} licenses: outside the 50–100,000 range. CUSTOM PRICING REQUIRED; no automatic price.`)];
  }
  return {
    parent: { type: "data_source_id", data_source_id: env("NOTION_DATA_SOURCE_ID") },
    properties,
    children: [
      ...(lead.isTest ? [callout("TEST RECORD: created to verify the integration. Not a real lead; safe to delete.", "🧪")] : []),
      ...[].concat(summary),
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
  if (!LEAD_SOURCES.includes(page.properties?.["Lead Source"]?.select?.name)) {
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
  const paths = pr["Lead Source"]?.select?.name === ACADEMY_SOURCE ? ACADEMY_PATH : PATH;
  let note;
  if (a.action === "schedule_call") {
    // Visitor opened the ChessMagic booking page. No obligation, no signing. Recorded once per record.
    if (pr["LaunchEd Path"]?.select?.name === paths.schedule_call) return { changed: false };
    put("LaunchEd Path", { select: { name: paths.schedule_call } });
    note = callout(`Schedule a Call: the customer opened the ChessMagic booking page (${new Date().toISOString()}). A meeting is confirmed only when it appears in the ChessMagic calendar. No purchase obligation.`, "📅");
  } else if (a.action === "sign_review") {
    put("LaunchEd Path", { select: { name: paths.sign_review } });
    if (pr["Agreement Status"]?.select?.name === AGREEMENT.notSent || !pr["Agreement Status"]?.select) {
      set["Agreement Status"] = { select: { name: AGREEMENT.pending } }; // advance from "Not sent" only
    }
    note = callout(`${paths.sign_review}: reviewed the DRAFT Order Form and confirmed signing authority (${new Date().toISOString()}). E-signature not yet enabled; sales to prepare the agreement once legal approval is complete.`, "✍️");
  } else {
    put("LaunchEd Path", { select: { name: paths.request_offer } });
    put("Follow-up Method", { select: { name: a.method } });
    put("Preferred Follow-up Time", { rich_text: rt(a.preferredTime) });
    if (a.ccEmail) { put("Representative Name", { rich_text: rt(a.ccName) }); put("Representative Email", { email: a.ccEmail }); }
    note = callout(`${paths.request_offer}: requested (${new Date().toISOString()}). Follow-up: ${a.method}, ${a.preferredTime}.${a.ccEmail ? ` Also send to ${a.ccName} <${a.ccEmail}>.` : ""}${a.notes ? ` Notes: ${a.notes}` : ""}`, "📌");
  }
  if (Object.keys(set).length) await notion(`/pages/${encodeURIComponent(page.id)}`, "PATCH", { properties: set });
  await notion(`/blocks/${encodeURIComponent(page.id)}/children`, "PATCH", { children: [note] });
  return { changed: true };
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
  const norm = (t) => (t === "text" ? "rich_text" : t);
  for (const [n, spec] of Object.entries(targetSchema())) {
    const have = props[n];
    if (!have || norm(have.type) !== spec.type) { problems.push(`"${n}" should be ${spec.type}, found ${have?.type || "missing"}`); continue; }
    const opts = (have[have.type]?.options || []).map((o) => o.name);
    for (const o of spec.options || []) if (have.type !== "status" && !opts.includes(o)) problems.push(`"${n}" option "${o}" missing`);
  }
  return { title: plain(ds.title), problems };
}
