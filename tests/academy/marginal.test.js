import test from "node:test";
import assert from "node:assert/strict";
import { quote, offerWindow, TIERS } from "../../lib/academy/pricing.js";

// Expected values written out by hand from the approved schedule (not computed by the code under test).
const cases = {
  //  n        standard        first year      savings
  50:     [   3_750_00,      2_625_00,      1_125_00],
  500:    [  37_500_00,     26_250_00,     11_250_00],
  501:    [  37_530_00,     26_271_00,     11_259_00],
  1000:   [  52_500_00,     36_750_00,     15_750_00],
  5000:   [ 172_500_00,    120_750_00,     51_750_00],
  5001:   [ 172_525_00,    120_767_50,     51_757_50],
  25000:  [ 672_500_00,    470_750_00,    201_750_00],
  25001:  [ 672_515_00,    470_760_50,    201_754_50],
  100000: [1_797_500_00,  1_258_250_00,   539_250_00],
};

test("marginal totals at every tier boundary (500/501, 5,000/5,001, 25,000/25,001) and the 1,000 example", () => {
  for (const [n, [std, fy, save]] of Object.entries(cases)) {
    const q = quote(+n);
    assert.equal(q.status, "ok", `n=${n}`);
    assert.equal(q.standardTotalCents, std, `standard n=${n}`);
    assert.equal(q.firstYearTotalCents, fy, `first year n=${n}`);
    assert.equal(q.savingsCents, save, `savings n=${n}`);
    assert.equal(q.renewalAnnualCents, std, `renewal = standard n=${n}`);
  }
});

test("CEO example: 1,000 students = 500 × $52.50 + 500 × $21.00 = $36,750", () => {
  const q = quote(1000);
  assert.deepEqual(q.bands.map((b) => [b.count, b.firstYearUnitCents, b.firstYearCents]), [[500, 5250, 2_625_000], [500, 2100, 1_050_000]]);
  assert.equal(q.firstYearTotalCents, 3_675_000);
});

test("the next license always costs exactly its band rate (one more student never lowers the total)", () => {
  let prev = quote(50);
  for (let n = 51; n <= 100000; n++) {
    const q = quote(n);
    const t = TIERS.find((x) => n >= x.from && n <= x.to);
    assert.equal(q.standardTotalCents - prev.standardTotalCents, t.unitCents, `standard step at ${n}`);
    assert.equal(q.firstYearTotalCents - prev.firstYearTotalCents, Math.round(t.unitCents * 0.7), `first-year step at ${n}`);
    prev = q;
  }
});

test("30% applies to every band in year one; bands add up; no discount outside the window", () => {
  for (const n of [50, 777, 5000, 12345, 60000, 100000]) {
    const q = quote(n);
    assert.equal(q.bands.reduce((s, b) => s + b.count, 0), n);
    assert.equal(q.bands.reduce((s, b) => s + b.firstYearCents, 0), q.firstYearTotalCents);
    for (const b of q.bands) assert.equal(b.firstYearUnitCents * 10, b.standardUnitCents * 7);
    const s = quote(n, { discount: false });
    assert.equal(s.firstYearTotalCents, s.standardTotalCents); assert.equal(s.savingsCents, 0); assert.equal(s.discountPct, 0);
  }
});

test("custom-quote policy below 50 and above 100,000; invalid input refused", () => {
  assert.equal(quote(49).status, "custom");
  assert.equal(quote(100001).status, "custom");
  for (const v of [0, -5, 10.5, NaN, "1000"]) assert.equal(quote(v).status, "invalid");
});

test("offer window: 30 days from the configured launch date (America/New_York)", () => {
  assert.equal(offerWindow(new Date(), "").status, "not_configured");
  const L = "2026-12-01";
  assert.equal(offerWindow(new Date("2026-12-01T04:59:00Z"), L).status, "upcoming"); // 11:59 pm Nov 30 ET
  assert.equal(offerWindow(new Date("2026-12-01T05:00:00Z"), L).status, "active");   // 12:00 am Dec 1 ET
  const w = offerWindow(new Date("2026-12-30T12:00:00Z"), L);
  assert.equal(w.status, "active"); assert.equal(w.endsDate, "2026-12-30");           // day 30
  assert.equal(offerWindow(new Date("2026-12-31T04:59:59Z"), L).status, "active");   // 11:59:59 pm Dec 30 ET
  assert.equal(offerWindow(new Date("2026-12-31T05:00:00Z"), L).status, "ended");
  // across the March DST change
  assert.equal(offerWindow(new Date("2027-03-01T04:59:00Z"), "2027-03-01").status, "upcoming");
  assert.equal(offerWindow(new Date("2027-03-31T03:59:59Z"), "2027-03-01").status, "active");  // 11:59:59 pm EDT Mar 30
  assert.equal(offerWindow(new Date("2027-03-31T04:00:00Z"), "2027-03-01").status, "ended");
});
