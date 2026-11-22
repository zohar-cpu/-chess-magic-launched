const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const FREE_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "hotmail.com", "outlook.com", "live.com", "msn.com",
  "aol.com", "icloud.com", "me.com", "mac.com", "proton.me", "protonmail.com", "gmx.com", "mail.com",
  "yandex.com", "zoho.com",
]);
// Eligible organization types. Keep in sync with the "Organization Type" options in Notion.
export const ORG_TYPES = ["School District", "Charter School", "Charter School Network"];
export const FOLLOWUP_METHODS = ["Zoom call", "Phone call", "Email"];
export const STATES = new Set(["Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut","Delaware","District of Columbia","Florida","Georgia","Hawaii","Idaho","Illinois","Indiana","Iowa","Kansas","Kentucky","Louisiana","Maine","Maryland","Massachusetts","Michigan","Minnesota","Mississippi","Missouri","Montana","Nebraska","Nevada","New Hampshire","New Jersey","New Mexico","New York","North Carolina","North Dakota","Ohio","Oklahoma","Oregon","Pennsylvania","Rhode Island","South Carolina","South Dakota","Tennessee","Texas","Utah","Vermont","Virginia","Washington","West Virginia","Wisconsin","Wyoming"]);

const str = (v, max) => (typeof v === "string" ? v.trim().replace(/[\u0000-\u001f]/g, " ").slice(0, max) : "");

/** Step 1: registration. Returns { ok, errors, lead } with whitelisted fields only. */
export function validateLead(b) {
  const errors = {};
  if (!b || typeof b !== "object") return { ok: false, errors: { body: "Invalid request." } };
  const lead = {
    submissionId: str(b.submissionId, 64),
    fullName: str(b.fullName, 120),
    email: str(b.email, 200).toLowerCase(),
    jobTitle: str(b.jobTitle, 120),
    orgName: str(b.orgName, 200),
    orgType: str(b.orgType, 40),
    state: str(b.state, 40),
    licenses: Number(b.licenses),
    phone: str(b.phone, 40) || null,
    consent: b.consent === true,
    utm: {},
  };
  if (!/^[\w-]{8,64}$/.test(lead.submissionId)) errors.submissionId = "Missing submission id.";
  if (lead.fullName.length < 2) errors.fullName = "Full name is required.";
  if (!EMAIL_RE.test(lead.email)) errors.email = "A valid email is required.";
  else if (FREE_DOMAINS.has(lead.email.split("@")[1])) errors.email = "Please use your professional email address.";
  if (lead.jobTitle.length < 2) errors.jobTitle = "Job title is required.";
  if (lead.orgName.length < 2) errors.orgName = "Organization name is required.";
  if (!ORG_TYPES.includes(lead.orgType)) errors.orgType = "Select a valid organization type.";
  if (!STATES.has(lead.state)) errors.state = "Select a valid state.";
  // Campaign + option. Requests without a campaign keep the original Showcase behavior.
  lead.campaign = b.campaign === "academy-2026" ? "academy-2026" : "showcase-2026";
  lead.intent = b.intent === "quote" ? "quote" : null; // email-campaign quote request (single step)
  lead.option = "offer"; // pilot requests use /api/pilot-register (separate, consent-based flow)
  if (lead.campaign === "academy-2026" && b.option !== "offer") errors.option = "Pilot requests use the pilot registration form.";
  if (lead.option === "offer") {
    if (!Number.isInteger(lead.licenses) || lead.licenses <= 0 || lead.licenses > 9_999_999)
      errors.licenses = "Enter a whole number of student licenses.";
  } else {
    lead.licenses = null;
    lead.pilotStudents = Number(b.pilotStudents);
    lead.pilotTeachers = b.pilotTeachers === "" || b.pilotTeachers == null ? null : Number(b.pilotTeachers);
    lead.pilotStart = str(b.pilotStart, 10) || null;
    if (!Number.isInteger(lead.pilotStudents) || lead.pilotStudents < 1 || lead.pilotStudents > 100000)
      errors.pilotStudents = "Enter the approximate number of students for the pilot.";
    if (lead.pilotTeachers !== null && (!Number.isInteger(lead.pilotTeachers) || lead.pilotTeachers < 1 || lead.pilotTeachers > 10000))
      errors.pilotTeachers = "Enter a whole number of teachers.";
    if (lead.pilotStart) {
      const d = new Date(lead.pilotStart + "T00:00:00Z"), today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(lead.pilotStart) || isNaN(d) || d < today || d - today > 180 * 864e5)
        errors.pilotStart = "Choose a start date within the next six months.";
    }
  }
  if (lead.phone && !/^[+()\d\s.\-x]{7,25}$/.test(lead.phone)) errors.phone = "Invalid phone number.";
  if (!lead.consent) errors.consent = "Consent is required.";
  if (b.utm && typeof b.utm === "object") {
    for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content"]) {
      const v = str(b.utm[k], 100);
      if (v) lead.utm[k] = v;
    }
  }
  return { ok: Object.keys(errors).length === 0, errors, lead };
}

/** Step 2: Option A ("sign_review") or Option B ("request_offer"). */
export function validateAction(b) {
  const errors = {};
  if (!b || typeof b !== "object") return { ok: false, errors: { body: "Invalid request." } };
  const a = {
    pageId: str(b.pageId, 64),
    token: str(b.token, 128),
    action: ["sign_review", "request_offer", "schedule_call"].includes(b.action) ? b.action : "",
  };
  if (!/^[0-9a-f-]{32,36}$/i.test(a.pageId)) errors.pageId = "Invalid record.";
  if (!/^[0-9a-f]{64}$/.test(a.token)) errors.token = "Invalid token.";
  if (!a.action) errors.action = "Unknown action.";
  if (a.action === "sign_review") {
    a.authorized = b.authorized === true;
    if (!a.authorized) errors.authorized = "Please confirm your signing authority.";
  }
  if (a.action === "request_offer") {
    a.method = str(b.method, 20);
    a.preferredTime = str(b.preferredTime, 120);
    a.notes = str(b.notes, 1000);
    a.ccName = str(b.ccName, 120);
    a.ccEmail = str(b.ccEmail, 200).toLowerCase();
    if (!FOLLOWUP_METHODS.includes(a.method)) errors.method = "Choose how we should follow up.";
    if (a.preferredTime.length < 2) errors.preferredTime = "Tell us when suits you.";
    if (a.ccEmail && !EMAIL_RE.test(a.ccEmail)) errors.ccEmail = "Invalid email address.";
    if (a.ccEmail && a.ccName.length < 2) errors.ccName = "Add the colleague's name.";
  }
  return { ok: Object.keys(errors).length === 0, errors, action: a };
}
