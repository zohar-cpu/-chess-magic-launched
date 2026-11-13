// READ-ONLY connection check. Writes nothing to Notion.
// Usage: NOTION_API_TOKEN=... NOTION_DATA_SOURCE_ID=... node scripts/notion-check.mjs
//   (or: vercel env pull .env.local && node --env-file=.env.local scripts/notion-check.mjs)
import { checkSchema, notionConfigured } from "../lib/notion.js";

if (!notionConfigured()) { console.error("Set NOTION_API_TOKEN and NOTION_DATA_SOURCE_ID first."); process.exit(1); }
try {
  const { title, problems } = await checkSchema();
  console.log(`Connected to data source: "${title}"`);
  if (problems.length) { console.error("Schema problems:\n - " + problems.join("\n - ")); process.exit(2); }
  console.log("All required properties and options are present. Ready to receive registrations.");
} catch (e) {
  console.error("Connection failed:", e.message);
  if (e.status === 401) console.error("→ The token is invalid. Re-copy it from the integration's settings.");
  if (e.status === 404) console.error("→ The integration can't see this data source. In Notion: database ••• → Connections → add \"LaunchEd Showcase 2026\".");
  process.exit(3);
}
