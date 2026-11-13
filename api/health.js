// GET /api/health — read-only setup check you can open in a browser.
// Reports whether the Notion connection works. Never returns secrets, tokens or lead data.
import { notionConfigured, checkSchema } from "../lib/notion.js";

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");
  if (req.method !== "GET") return res.status(405).send(JSON.stringify({ ok: false }));

  const has = (k) => !!(process.env[k] || "").trim();
  const settings = { NOTION_API_TOKEN: has("NOTION_API_TOKEN") ? "set" : "MISSING", NOTION_DATA_SOURCE_ID: has("NOTION_DATA_SOURCE_ID") ? "set" : "MISSING" };
  if (!notionConfigured()) {
    return res.status(200).send(JSON.stringify({ ok: false, status: "Settings missing in Vercel. Add them, then redeploy.", settings }));
  }
  try {
    const { title, problems } = await checkSchema();
    return res.status(200).send(JSON.stringify({
      ok: problems.length === 0,
      status: problems.length === 0 ? "Connected to Notion. Registrations will be saved." : "Connected, but the database is missing fields.",
      database: title, settings, problems,
    }));
  } catch (e) {
    const status = e.status === 401 ? "Notion rejected the token. Re-copy the Internal Integration Secret into NOTION_API_TOKEN, then redeploy."
      : e.status === 404 ? "The integration can't see the database. In Notion open Business Partners Dashboard → ••• → Connections → add \"LaunchEd Showcase 2026\"."
      : e.status === 400 ? "NOTION_DATA_SOURCE_ID looks wrong. It should be 3feba0a2-da2c-80b0-bcbf-000bc124678e."
      : "Could not reach Notion right now. Try again in a minute.";
    return res.status(200).send(JSON.stringify({ ok: false, status, settings }));
  }
}
