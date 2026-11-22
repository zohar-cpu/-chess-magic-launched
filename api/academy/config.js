// GET /api/config — public campaign settings for the page (no secrets, no personal data).
import { offerWindow, DISCOUNT_PCT } from "../../lib/academy/pricing.js";
import { pilotRegistrationOpen } from "../../lib/academy/legal.js";

export default function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "public, max-age=300");
  const w = offerWindow();
  res.status(200).send(JSON.stringify({ ok: true, offer: { ...w, discountPct: DISCOUNT_PCT }, pilotOpen: pilotRegistrationOpen(), signingEnabled: false }));
}
