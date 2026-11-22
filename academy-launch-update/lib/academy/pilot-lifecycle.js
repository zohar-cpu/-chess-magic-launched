// Pilot lifecycle rules. A pilot request NEVER starts the 30 days and NEVER activates students.
// Activation is a staff action that is allowed only when every gate is met, and is globally
// switched OFF until legal/privacy documents are approved.
import { pilotRegistrationOpen } from "./legal.js";

export const PILOT_DAYS = 30;
export const DPA_OK = ["Signed", "Not required (confirmed by school)"];

// Hard lock in code: student activation needs a GT-approved Pilot Order Form and student data
// protection agreement. A setting alone can never switch it on. Change this only after approval.
export const ACTIVATION_DOCUMENTS_APPROVED = false;

/** Global switch: false unless STUDENT_ACTIVATION_ENABLED=true AND the activation documents are approved. */
export const studentActivationEnabled = () =>
  ACTIVATION_DOCUMENTS_APPROVED && (process.env.STUDENT_ACTIVATION_ENABLED || "").trim() === "true" && pilotRegistrationOpen();

/** Checks a pilot record (Notion properties as plain values). Returns { ready, missing[] }. */
export function activationCheck(r) {
  const missing = [];
  if (!studentActivationEnabled()) missing.push("Student activation is switched off until legal and privacy documents are approved.");
  if (r.schoolApproval !== "Received") missing.push("School approval not received.");
  if (!DPA_OK.includes(r.dpaStatus)) missing.push("Student data protection agreement not signed (or not confirmed as not required).");
  if (!["Pending School / Privacy Approval", "Pilot Approved"].includes(r.pilotStatus)) missing.push(`Pilot status is "${r.pilotStatus || "empty"}".`);
  if (r.pilotStartDate) missing.push("Pilot already has a start date.");
  return { ready: missing.length === 0, missing };
}

/** The 30-day period starts on the activation day: day 1 = activation date, day 30 = +29 days. */
export function pilotPeriod(activationDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(activationDate || "")) throw new Error("Activation date required (YYYY-MM-DD).");
  const d = new Date(activationDate + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + PILOT_DAYS - 1);
  return { start: activationDate, end: d.toISOString().slice(0, 10) };
}

/** What a submission writes: never a start date, never an active status. */
export const SUBMISSION_STATE = Object.freeze({ pilotStatus: "Pilot Requested", schoolApproval: "Not received", dpaStatus: "To be determined", pilotStartDate: null });
