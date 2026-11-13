// Authoritative pricing. The browser shows the same numbers, but the server
// always recalculates from here and never trusts client-sent prices.
export const DISCOUNT_PCT = 30;

export const TIERS = Object.freeze([
  { min: 50,    max: 399,    unitCents: 7500 },
  { min: 400,   max: 5000,   unitCents: 4000 },
  { min: 5001,  max: 25000,  unitCents: 3500 },
  { min: 25001, max: 100000, unitCents: 2700 },
]);

const eventUnit = (c) => Math.round((c * (100 - DISCOUNT_PCT)) / 100);

/** Returns a quote in integer cents. Quantities outside the tiers → status "custom" (no invented rates). */
export function quote(licenses) {
  if (!Number.isInteger(licenses) || licenses <= 0) return { status: "invalid", licenses };
  const tier = TIERS.find((t) => licenses >= t.min && licenses <= t.max);
  if (!tier) return { status: "custom", licenses };
  const ev = eventUnit(tier.unitCents);
  const standardTotalCents = tier.unitCents * licenses;
  const eventTotalCents = ev * licenses;
  return {
    status: "ok",
    licenses,
    tier: `${tier.min}-${tier.max}`,
    discountPct: DISCOUNT_PCT,
    standardUnitCents: tier.unitCents,
    eventUnitCents: ev,
    standardTotalCents,
    eventTotalCents,
    savingsCents: standardTotalCents - eventTotalCents,
    currency: "USD",
    taxesIncluded: false,
  };
}

export const usd = (cents) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
