// Notion CRM schema used by the website (Business Partners Dashboard, data source
// 3feba0a2-da2c-80b0-bcbf-000bc124678e). One record per website request; no new database.
//
// EXISTING = already in Notion today (verified read-only on 2026-11-19).
// PROPOSED = minimum additions awaiting the CEO's approval. NOTHING HERE IS APPLIED TO NOTION
// AUTOMATICALLY: /api/health and scripts/notion-check.mjs only REPORT what is missing.

export const EXISTING = {
  Name: { type: "title" },
  "Lead Source": { type: "select", options: ["LaunchEd Showcase 2026"] },
  "Sales Status": { type: "status", options: ["Not started", "Proposal sent", "Done WIN"] },
  "Type of person": { type: "multi_select", options: ["Customer"] },
  Region: { type: "multi_select", options: ["US"] },
  Department: { type: "multi_select", options: ["Sales"] },
  "Contact Name": { type: "rich_text" }, "Contact Email": { type: "email" }, "Contact Phone": { type: "phone_number" },
  "Job Title": { type: "rich_text" },
  "Organization Type": { type: "select", options: ["School District", "Charter School", "Charter School Network"] },
  State: { type: "select" },
  "Student Licenses": { type: "number" }, "LaunchEd Discount": { type: "number" },
  "Standard Price per Student": { type: "number" }, "Event Price per Student": { type: "number" },
  "Annual Contract Value": { type: "number" }, "Annual Savings": { type: "number" },
  "LaunchEd Path": { type: "select", options: ["Review & Sign", "Request Exclusive Offer"] },
  "Agreement Status": { type: "select", options: ["Not sent", "Pending (sales to send)", "Sent for signature", "Signed", "Declined"] },
  "Follow-up Method": { type: "select", options: ["Zoom call", "Phone call", "Email"] },
  "Preferred Follow-up Time": { type: "rich_text" }, "Representative Name": { type: "rich_text" }, "Representative Email": { type: "email" },
  "Submission ID": { type: "rich_text" }, "LaunchEd Reference": { type: "rich_text" }, "Submitted At": { type: "date" },
  "Test Record": { type: "checkbox" },
  "Schools Implementation Tracker": { type: "relation" },
};

// New select OPTIONS on existing properties.
export const PROPOSED_OPTIONS = {
  "Lead Source": ["ChessMagic Academy Launch"],
  "LaunchEd Path": ["Request a Quote"],
};

// New PROPERTIES (12). Formulas are created in Notion, never written by the website.
export const PROPOSED = {
  "Campaign Option": { type: "select", options: ["Free 30-Day Pilot", "30% Launch Offer"], why: "Separates pilot requests from licensing quotes." },
  "Pilot Status": { type: "select", options: ["Pilot Requested", "Pending School / Privacy Approval", "Pilot Approved", "Pilot Active", "Pilot Completed", "Converted to Paid"], why: "Pilot lifecycle, set by staff after the request." },
  "Pilot Students": { type: "number", why: "Estimated students (a number only; no student data)." },
  "School Approval": { type: "select", options: ["Not received", "Received"], why: "Activation gate 1." },
  "DPA Status": { type: "select", options: ["To be determined", "Required – pending signature", "Signed", "Not required (confirmed by school)"], why: "Activation gate 2 (privacy documentation)." },
  "Activation Ready": { type: "formula", website: false, formula: 'and(prop("School Approval") == "Received", or(prop("DPA Status") == "Signed", prop("DPA Status") == "Not required (confirmed by school)"))', why: "Shows ✅ only when both gates are met." },
  "Pilot Start Date": { type: "date", website: false, why: "Set by staff ON ACTIVATION (not at submission). Day 1 of the 30 days." },
  "Pilot End Date": { type: "formula", website: false, formula: 'if(empty(prop("Pilot Start Date")), "", dateAdd(prop("Pilot Start Date"), 29, "days"))', why: "Day 30 = start + 29 days." },
  "Consent Reference": { type: "rich_text", why: "Pointer to the private consent record (no consent text in Notion)." },
  "Marketing Opt-in": { type: "checkbox", why: "Optional marketing consent from the pilot form." },
  "Renewal Annual Price": { type: "number", why: "Standard annual price for the same quantity (year 2 onward)." },
  "Offer Valid Until": { type: "date", why: "Last day of the 30-day launch window when the quote was requested." },
};

// Proposed views (created by hand in Notion after approval; no API writes).
export const PROPOSED_VIEWS = [
  { name: "Pilot Requests", type: "board", filter: 'Campaign Option = "Free 30-Day Pilot"', groupBy: "Pilot Status" },
  { name: "Ready to Activate", type: "table", filter: 'Activation Ready = true AND Pilot Status is "Pending School / Privacy Approval" or "Pilot Approved"' },
  { name: "Quote Requests", type: "table", filter: 'Campaign Option = "30% Launch Offer"', sort: "Submitted At, newest first" },
];

/** Full schema the website code writes against (existing + proposed). Used by checks and the QA stand-in. */
export function targetSchema() {
  const out = {};
  for (const [k, v] of Object.entries(EXISTING)) out[k] = { ...v, options: [...(v.options || []), ...(PROPOSED_OPTIONS[k] || [])] };
  for (const [k, v] of Object.entries(PROPOSED)) out[k] = { ...v };
  return out;
}
