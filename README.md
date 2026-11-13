# Chess Magic · LaunchEd Showcase 2026 Landing Page

A mobile-first landing page with a live pricing calculator, a registration flow with two paths, and a backend ready to connect to your services.

## 1. Works right now (no credentials needed)

| Feature | Where |
|---|---|
| Responsive landing page (hero, pricing table, What's Included, form) | `public/index.html` |
| Pricing calculator (rates: 50–399 $75 · 400–5,000 $40 · 5,001–25,000 $35 · 25,001–100,000 $27, all 30% off) | in-page |
| "Contact Sales for Custom Pricing" below 50 or above 100,000 licenses (no invented rates) | in-page + `lib/pricing.js` |
| Form validation: professional-email check, signer-authority confirmation, representative fields for Option B | in-page + `lib/validate.js` |
| Server-side price recalculation (client prices are never trusted) | `lib/pricing.js` |
| Unit tests | `npm test` |
| Print-ready QR generator (SVG vector + 4096 px PNG, high error correction) | `npm run qr -- https://FINAL-URL` |

**Honest by design:** the confirmation screen appears **only** after the backend confirms the lead was stored in the CRM. If the backend isn't connected, visitors see "Nothing has been submitted" and a sales contact. Signed status is set **only** by the e-signature provider's verified webhook.

## 2. Notion CRM (replaces HubSpot)

Registrations go to the **Business Partners Dashboard**:

| | ID |
|---|---|
| Database (from your URL, not used for writes) | `3feba0a2-da2c-8059-b729-cd201e71fab7` |
| View (`?v=` in your URL, not a database) | `3feba0a2-da2c-805b-b8f5-000c465d0e7e` |
| **Data source (what the API writes to)** | **`3feba0a2-da2c-80b0-bcbf-000bc124678e`** |

Each registration creates **one new page**. Reused fields: Name = organization, Sales Status, Type of person = Customer, Region = US, Department = Sales. LaunchEd fields: Lead Source = "LaunchEd Showcase 2026", contact details, Organization Type, State, Student Licenses, standard and event price per student, Annual Contract Value, Annual Savings, LaunchEd Path, Agreement Status, representative, Submission ID, Reference, Submitted At and Test Record.

Sales Status: reservation or new lead → **Not started**; agreement sent for signature → **Proposal sent**; signed by both parties (webhook only) → **Done WIN**.

**Duplicates:** before creating a page, the API checks LaunchEd records for the same Submission ID, the same contact email, or the same organization (normalized). If it finds a match, it creates nothing, changes nothing, and tells the visitor they're already registered. Existing records are never edited. The only updates are status changes from the e-sign webhook, and only on pages whose Lead Source is LaunchEd.

### Configure the token (Vercel)
1. In Notion: Settings → Connections → Develop or manage integrations → "LaunchEd Showcase 2026" → copy the **Internal Integration Secret**. Capabilities needed: Read, Insert and Update content. No user information or comments.
2. In Vercel: Project → Settings → Environment Variables → add `NOTION_API_TOKEN`. Mark it **Sensitive** and scope it to **Production** (and Preview only if you test there). Never paste it into `index.html`, chat, Git or tickets.
   - CLI alternative: `vercel env add NOTION_API_TOKEN production --sensitive`. Paste the value at the prompt so it stays out of your shell history.
3. Add `NOTION_DATA_SOURCE_ID` = `3feba0a2-da2c-80b0-bcbf-000bc124678e` and `LAUNCHED_TEST_KEY` = a random string (`openssl rand -hex 24`), also marked Sensitive.
4. **Redeploy.** Environment changes only apply to new deployments.
5. Read-only check: `vercel env pull .env.local && node --env-file=.env.local scripts/notion-check.mjs`. Delete `.env.local` afterwards.
6. Test: `LAUNCHED_TEST_KEY=... node scripts/send-test-lead.mjs https://YOUR-DEPLOYMENT`. This creates one `[TEST] Chess Magic Integration Test District` record with Test Record checked.
7. If the token ever leaks: rotate it in the integration settings, update Vercel, and redeploy.

## Customer journey
1. **Register.** The record is created in Notion first. The confirmation screen appears **only** after Notion confirms the save; failures show "Your registration was NOT saved".
2. Then the visitor chooses:
   - **Option A: Review & Sign License Agreement.** Shows a personalized **DRAFT** Order Form built from the official agreement's Order Form wording, with an authority confirmation and "Notify me when signing opens". Binding e-signature is **disabled**.
   - **Option B: Request My Exclusive Offer.** Follow-up method and time, an optional colleague, and notes. This works without any e-signature integration.
3. Option choices update **only the visitor's own new record** (HMAC-signed link), fill **only empty fields**, and append the full request as a note.

**Duplicates:** the same submit twice returns the same record, and the same email + same organization creates nothing new. **A different contact from the same organization gets their own record.**

## Pricing cliffs (for commercial approval, not changed)
| Boundary | Event total just below | Event total just above | Quantities that pay more than the next tier |
|---|---|---|---|
| 399 → 400 | $20,947.50 | $11,200.00 | 214–399 |
| 5,000 → 5,001 | $140,000.00 | $122,524.50 | 4,376–5,000 |
| 25,000 → 25,001 | $612,500.00 | $472,518.90 | 19,287–25,000 |

## 3. Still needs decisions
- **E-signature:** stays disabled until counsel approves the agreement (see the pre-signing review doc).
- **Agreement pricing:** the agreement's pricing schedule must be updated to the current rate card.
- **Brand assets, Privacy Policy URL, sales email.**

## Data flow

```
Browser ──POST /api/leads──▶ validate + recalc price ──▶ Notion: duplicate check ──▶ new page (Sales Status "Not started")
                                   ├─▶ Dropbox Sign (Option A, once approved) ──▶ "Proposal sent" / "Sent for signature"
                                   └─▶ optional Resend / Slack alert to sales
Dropbox Sign ──POST /api/esign-webhook (HMAC-verified)──▶ "Done WIN" / "Signed" (LaunchEd records only)
```

Lead data lives only on the server side and in the CRM. Nothing is stored in the browser, and API keys are never sent to the client.

Production hardening: the rate limiter and idempotency cache only last per serverless instance. For heavy traffic, back them with Upstash Redis.
