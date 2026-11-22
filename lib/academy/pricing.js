// Authoritative pricing (server side). The browser shows the same numbers, but the server
// always recalculates from here and never trusts client-sent prices.
//
// MODEL (approved by the CEO, 2026-11-19): PROGRESSIVE / MARGINAL tiers.
// Each rate applies ONLY to the licenses that fall inside its band, like tax brackets.
//   first 500 students        $75.00 per student
//   students 501–5,000        $30.00 per additional student
//   students 5,001–25,000     $25.00 per additional student
//   students 25,001–100,000   $15.00 per additional student
// Launch offer: 30% off every band, FIRST YEAR ONLY, during a 30-day window from the campaign
// launch date. Renewals are at the standard annual price (and the contract's renewal terms).
// Orders below 50 or above 100,000 students follow the custom-quote policy (no automatic price).
// Because every band rate is positive, the total can never decrease when licenses are added.

export const DISCOUNT_PCT = 30;
export const MIN_LICENSES = 50;
export const MAX_LICENSES = 100000;
export const OFFER_DAYS = 30;

export const TIERS = Object.freeze([
  { from: 1,     to: 500,    unitCents: 7500 },
  { from: 501,   to: 5000,   unitCents: 3000 },
  { from: 5001,  to: 25000,  unitCents: 2500 },
  { from: 25001, to: 100000, unitCents: 1500 },
]);

const discounted = (c) => Math.round((c * (100 - DISCOUNT_PCT)) / 100); // exact for all four rates

/**
 * Campaign window. Launch date comes from configuration (CAMPAIGN_LAUNCH_DATE, YYYY-MM-DD,
 * U.S. Eastern business day). The offer is valid from 00:00 on the launch date through 23:59:59
 * on day 30, America/New_York. Returns { status, launchDate, endsDate }.
 *   status: "not_configured" | "upcoming" | "active" | "ended"
 */
export function offerWindow(now = new Date(), launch = (process.env.CAMPAIGN_LAUNCH_DATE || "").trim()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(launch)) return { status: "not_configured", launchDate: null, endsDate: null };
  const start = easternMidnight(launch);
  const endsDate = addDays(launch, OFFER_DAYS - 1);
  const end = easternMidnight(addDays(launch, OFFER_DAYS)); // exclusive
  const status = now < start ? "upcoming" : now < end ? "active" : "ended";
  return { status, launchDate: launch, endsDate };
}
function addDays(ymd, n) { const d = new Date(ymd + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function easternMidnight(ymd) {
  // Midnight America/New_York for the given date, DST-aware, without external libraries.
  const guess = new Date(ymd + "T05:00:00Z");
  const hh = +new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hourCycle: "h23" }).format(guess);
  return new Date(guess.getTime() - hh * 3600e3);
}

/**
 * Quote in integer cents.
 * opts.discount: true → apply the 30% first-year launch discount (callers pass offerWindow().status === "active").
 * Returns status "ok" with a per-band breakdown, or "custom" / "invalid".
 */
export function quote(licenses, opts = { discount: true }) {
  if (!Number.isInteger(licenses) || licenses <= 0) return { status: "invalid", licenses };
  if (licenses < MIN_LICENSES || licenses > MAX_LICENSES) return { status: "custom", licenses };
  const discount = opts.discount !== false;
  const bands = [];
  let standardTotalCents = 0, firstYearTotalCents = 0;
  for (const t of TIERS) {
    if (licenses < t.from) break;
    const count = Math.min(licenses, t.to) - t.from + 1;
    const fyUnit = discount ? discounted(t.unitCents) : t.unitCents;
    bands.push({ from: t.from, to: Math.min(licenses, t.to), count, standardUnitCents: t.unitCents, firstYearUnitCents: fyUnit,
                 standardCents: count * t.unitCents, firstYearCents: count * fyUnit });
    standardTotalCents += count * t.unitCents;
    firstYearTotalCents += count * fyUnit;
  }
  return {
    status: "ok", model: "marginal", licenses, discountApplied: discount, discountPct: discount ? DISCOUNT_PCT : 0,
    bands, standardTotalCents, firstYearTotalCents, savingsCents: standardTotalCents - firstYearTotalCents,
    renewalAnnualCents: standardTotalCents, // year 2 onward at standard rates for the same quantity
    avgStandardCents: Math.round(standardTotalCents / licenses), avgFirstYearCents: Math.round(firstYearTotalCents / licenses),
    // Back-compat aliases used by older code paths (Showcase leads, e-sign fields):
    eventTotalCents: firstYearTotalCents, tier: bands.map((b) => `${b.from}-${b.to}`).join(","),
    standardUnitCents: Math.round(standardTotalCents / licenses), eventUnitCents: Math.round(firstYearTotalCents / licenses),
    currency: "USD", taxesIncluded: false,
  };
}

export const usd = (cents) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
export const int = (n) => new Intl.NumberFormat("en-US").format(n);
