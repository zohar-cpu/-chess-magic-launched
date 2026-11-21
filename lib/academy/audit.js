// Append-only consent audit records, kept OUTSIDE Notion in a private Postgres database
// (Neon via the Vercel Marketplace, which adds DATABASE_URL automatically; no keys to handle).
// The application only ever INSERTs. There is no API that reads these records back;
// access is through the database console by named administrators only.
import crypto from "node:crypto";
import { neon } from "@neondatabase/serverless";

const env = (k) => (process.env[k] || "").trim();
export const auditConfigured = () => !!env("DATABASE_URL");
let sqlFn = null;
let ready = false;
const sql = () => (sqlFn ||= neon(env("DATABASE_URL")));
export function _setSqlForTests(fn) { sqlFn = fn; ready = false; }

async function ensureTable() {
  if (ready) return;
  await sql()`CREATE TABLE IF NOT EXISTS pilot_consent_records (
    id               BIGSERIAL PRIMARY KEY,
    submission_ref   TEXT NOT NULL UNIQUE,
    submission_id    TEXT NOT NULL UNIQUE,
    recorded_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    org_name         TEXT NOT NULL,
    contact_name     TEXT NOT NULL,
    contact_email    TEXT NOT NULL,
    state            TEXT NOT NULL,
    terms_version    TEXT NOT NULL,
    privacy_version  TEXT NOT NULL,
    consent_terms_text     TEXT NOT NULL,
    consent_privacy_text   TEXT NOT NULL,
    consent_authority_text TEXT NOT NULL,
    marketing_opt_in       BOOLEAN NOT NULL,
    marketing_text         TEXT,
    ip_hash          TEXT,
    user_agent       TEXT,
    record_hash      TEXT NOT NULL,
    retain_until     DATE NOT NULL
  )`;
  ready = true;
}

/**
 * Writes one consent record. Idempotent per submission (a retry never creates a second record).
 * Returns { created: boolean }.
 */
export async function writeConsentRecord(r) {
  await ensureTable();
  const years = Number(env("CONSENT_RETENTION_YEARS") || 7); // counsel to confirm
  const retainUntil = new Date(Date.now() + years * 365.25 * 864e5).toISOString().slice(0, 10);
  const body = {
    submission_ref: r.reference, submission_id: r.submissionId, org_name: r.orgName, contact_name: r.fullName,
    contact_email: r.email, state: r.state, terms_version: r.termsVersion, privacy_version: r.privacyVersion,
    consent_terms_text: r.texts.terms, consent_privacy_text: r.texts.privacy, consent_authority_text: r.texts.authority,
    marketing_opt_in: !!r.marketing, marketing_text: r.marketing ? r.texts.marketing : null,
    ip_hash: r.ipHash || null, user_agent: (r.userAgent || "").slice(0, 300) || null, recorded_at_client: r.clientTime || null,
  };
  const recordHash = crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex"); // tamper evidence
  const rows = await sql()`INSERT INTO pilot_consent_records
    (submission_ref, submission_id, org_name, contact_name, contact_email, state, terms_version, privacy_version,
     consent_terms_text, consent_privacy_text, consent_authority_text, marketing_opt_in, marketing_text,
     ip_hash, user_agent, record_hash, retain_until)
    VALUES (${body.submission_ref}, ${body.submission_id}, ${body.org_name}, ${body.contact_name}, ${body.contact_email},
     ${body.state}, ${body.terms_version}, ${body.privacy_version}, ${body.consent_terms_text}, ${body.consent_privacy_text},
     ${body.consent_authority_text}, ${body.marketing_opt_in}, ${body.marketing_text}, ${body.ip_hash}, ${body.user_agent},
     ${recordHash}, ${retainUntil})
    ON CONFLICT (submission_id) DO NOTHING
    RETURNING id`;
  return { created: rows.length > 0 };
}
