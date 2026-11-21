// Single source of truth for the pilot's legal documents and consent wording.
// The server stores THIS text (not text sent by the browser) in the consent record; the document
// versions are stored in their own columns of the same record.
// RELEASE CONTROL: pilot registration stays closed while any version contains "DRAFT"
// or PILOT_REGISTRATION_OPEN is not "true". Both must change, after counsel approval.
export const LEGAL = {
  terms:   { name: "ChessMagic Academy 30-Day Pilot Terms of Use", version: "PILOT-TERMS-DRAFT-2026-11-18",    url: "legal/pilot-terms.html" },
  privacy: { name: "Chess-Magic Inc. Privacy Notice",               version: "PRIVACY-NOTICE-DRAFT-2026-11-18", url: "legal/privacy-notice.html" },
  dpa:     { name: "Student Data Protection Addendum",              version: "STUDENT-DPA-DRAFT-2026-11-18",    url: "legal/student-dpa.html" },
};

export const CONSENT_TEXT = {
  terms: `I have read and accept the ChessMagic Academy 30-Day Pilot Terms of Use.`,
  privacy: `I acknowledge the Chess-Magic Inc. Privacy Notice, which explains how the information in this form is used.`,
  authority: "I confirm that I am authorized by my school or organization to request this pilot. I understand that no student accounts will be activated, and no student information may be shared with Chess-Magic Inc., until my school or organization has given all required approvals and any required student data protection agreement has been signed.",
  marketing: "Optional: send me occasional emails about ChessMagic Academy news and offers. I can unsubscribe at any time. This is not required for the pilot.",
};

export const pilotRegistrationOpen = () =>
  (process.env.PILOT_REGISTRATION_OPEN || "").trim() === "true" &&
  !/DRAFT/i.test(LEGAL.terms.version + LEGAL.privacy.version);
