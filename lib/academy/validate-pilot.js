import { STATES } from "./validate.js";
import { LEGAL } from "./legal.js";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const FREE = new Set(["gmail.com","googlemail.com","yahoo.com","hotmail.com","outlook.com","live.com","msn.com","aol.com","icloud.com","me.com","mac.com","proton.me","protonmail.com","gmx.com","mail.com","yandex.com","zoho.com"]);
const str = (v, max) => (typeof v === "string" ? v.trim().replace(/[\u0000-\u001f]/g, " ").slice(0, max) : "");

/** Pilot registration: exactly six data fields + consents. No student information is accepted. */
export function validatePilot(b) {
  const errors = {};
  if (!b || typeof b !== "object") return { ok: false, errors: { body: "Invalid request." } };
  const c = b.consents || {};
  const p = {
    submissionId: str(b.submissionId, 64),
    orgName: str(b.orgName, 200), fullName: str(b.fullName, 120), email: str(b.email, 200).toLowerCase(),
    jobTitle: str(b.jobTitle, 120), state: str(b.state, 40), pilotStudents: Number(b.pilotStudents),
    marketing: c.marketing === true,
  };
  if (!/^[\w-]{8,64}$/.test(p.submissionId)) errors.submissionId = "Missing submission id.";
  if (p.orgName.length < 2) errors.orgName = "School or organization name is required.";
  if (p.fullName.length < 2) errors.fullName = "Full name is required.";
  if (!EMAIL_RE.test(p.email)) errors.email = "A valid work email is required.";
  else if (FREE.has(p.email.split("@")[1])) errors.email = "Please use your work email address.";
  if (p.jobTitle.length < 2) errors.jobTitle = "Role / job title is required.";
  if (!STATES.has(p.state)) errors.state = "Select a valid state.";
  if (!Number.isInteger(p.pilotStudents) || p.pilotStudents < 1 || p.pilotStudents > 100000) errors.pilotStudents = "Enter an estimated number of students.";
  // Mandatory acknowledgments: must be explicitly true AND for the current document versions.
  if (c.terms !== true) errors.terms = "Please confirm that this is a non-binding request.";
  if (c.privacy !== true) errors.privacy = "Please acknowledge the Privacy Policy.";
  if (c.authority !== true) errors.authority = "Please confirm your authority and approval obligations.";
  if (c.termsVersion !== LEGAL.terms.version || c.privacyVersion !== LEGAL.privacy.version)
    errors.versions = "The legal documents were updated. Please reload the page and review them again.";
  // Defense in depth: reject anything that looks like student data being sent.
  for (const k of Object.keys(b)) if (/student(name|s?_?list|email|id|dob|birth)/i.test(k)) errors.studentData = "Student information is not accepted at registration.";
  return { ok: Object.keys(errors).length === 0, errors, pilot: p };
}
