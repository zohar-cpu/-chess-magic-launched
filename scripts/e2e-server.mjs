// LOCAL TEST SERVER ONLY — never deployed (Vercel serves /public + /api directly).
// Serves the site and runs the real /api handlers against an IN-MEMORY Notion stand-in and an
// in-memory consent store, so the full browser flow can be tested without touching the live CRM.
//   E2E_GATE=closed (default) → pilot registration behaves exactly as in production today (locked).
//   E2E_GATE=open             → simulates the state after counsel approval (non-draft versions + flag on).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = +(process.env.PORT || 4317);
const GATE_OPEN = process.env.E2E_GATE === "open";

process.env.NOTION_API_TOKEN = "e2e-fake-token-not-real";
process.env.NOTION_DATA_SOURCE_ID = "ds-main";
process.env.DATABASE_URL = "postgres://e2e-fake";
process.env.EMAIL_MODE = "capture";                 // QA: emails are captured, never sent
process.env.CAMPAIGN_LAUNCH_DATE ||= new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10); // offer active in staging
delete process.env.ALLOWED_ORIGIN;

const legal = await import(path.join(ROOT, "lib/legal.js"));
const DRAFT = { terms: legal.LEGAL.terms.version, privacy: legal.LEGAL.privacy.version };
if (GATE_OPEN) {
  legal.LEGAL.terms.version = "PILOT-TERMS-E2E-APPROVED";
  legal.LEGAL.privacy.version = "PRIVACY-NOTICE-E2E-APPROVED";
  process.env.PILOT_REGISTRATION_OPEN = "true";
}

// ---- In-memory Notion stand-in (only the endpoints the integration uses) ----
// It ENFORCES the proposed CRM schema (lib/crm-schema.js): unknown properties, wrong types, unknown
// select options or writes to formula properties are rejected with HTTP 400, like Notion would.
const { targetSchema } = await import(path.join(ROOT, "lib/crm-schema.js"));
const SCHEMA = targetSchema();
function schemaError(props) {
  for (const [k, v] of Object.entries(props || {})) {
    const spec = SCHEMA[k]; const type = Object.keys(v)[0];
    if (!spec) return `${k} is not a property that exists.`;
    if (spec.type === "formula") return `${k} is a formula and cannot be written.`;
    if (spec.type !== type) return `${k} is expected to be ${spec.type}.`;
    const names = type === "select" ? [v.select?.name] : type === "multi_select" ? v.multi_select.map((o) => o.name) : type === "status" ? [v.status?.name] : [];
    if (spec.options && spec.options.length && k !== "State") for (const nme of names) if (!spec.options.includes(nme)) return `Invalid select option "${nme}" for ${k}.`;
  }
  return null;
}
export const store = { "ds-main": [], blocks: {}, calls: [] };
let seq = 0;
const val = (p) => {
  if (!p) return null;
  switch (p.type || Object.keys(p)[0]) {
    case "title": return (p.title || []).map((t) => t.text?.content ?? t.plain_text ?? "").join("");
    case "rich_text": return (p.rich_text || []).map((t) => t.text?.content ?? t.plain_text ?? "").join("");
    case "select": return p.select?.name ?? null;
    case "status": return p.status?.name ?? null;
    case "email": return p.email ?? null;
    case "checkbox": return !!p.checkbox;
    default: return p[p.type];
  }
};
const normalize = (props) => {
  const out = {};
  for (const [k, v] of Object.entries(props)) {
    const type = Object.keys(v)[0];
    const nv = { type, ...v };
    if (type === "title" || type === "rich_text") nv[type] = v[type].map((t) => ({ ...t, plain_text: t.text.content }));
    out[k] = nv;
  }
  return out;
};
function match(page, f) {
  if (!f) return true;
  if (f.and) return f.and.every((x) => match(page, x));
  if (f.or) return f.or.some((x) => match(page, x));
  const v = val(page.properties[f.property]);
  if (f.select) return v === f.select.equals;
  if (f.checkbox) return !!v === f.checkbox.equals;
  if (f.rich_text) return v === f.rich_text.equals;
  if (f.email) return (v || "").toLowerCase() === f.email.equals;
  if (f.title) return (v || "").toLowerCase().includes(f.title.contains.toLowerCase());
  throw new Error("unsupported filter " + JSON.stringify(f));
}
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  if (!String(url).startsWith("https://api.notion.com/v1")) return realFetch(url, opts);
  const p = String(url).slice("https://api.notion.com/v1".length), m = opts.method || "GET";
  const body = opts.body ? JSON.parse(opts.body) : null;
  store.calls.push(`${m} ${p.replace(/[0-9a-f-]{20,}/g, ":id")}`);
  const json = (s, j) => new Response(JSON.stringify(j), { status: s, headers: { "Content-Type": "application/json" } });
  let mm;
  if (m === "POST" && (mm = p.match(/^\/data_sources\/([^/]+)\/query$/))) return json(200, { results: (store[mm[1]] || []).filter((x) => match(x, body.filter)), has_more: false });
  if ((m === "POST" && p === "/pages") || (m === "PATCH" && /^\/pages\//.test(p))) { const err = schemaError(body.properties); if (err) return json(400, { code: "validation_error", message: err }); }
  if (m === "POST" && p === "/pages") {
    const ds = body.parent.data_source_id, id = `e2e${String(++seq).padStart(5, "0")}-0000-0000-0000-000000000000`;
    const page = { id, url: `https://notion.example/${id}`, properties: normalize(body.properties) };
    store[ds].push(page); store.blocks[id] = body.children || []; return json(200, page);
  }
  const all = () => [...store["ds-main"]];
  if ((mm = p.match(/^\/pages\/([^/]+)$/))) {
    const page = all().find((x) => x.id === decodeURIComponent(mm[1])); if (!page) return json(404, { code: "object_not_found" });
    if (m === "PATCH") Object.assign(page.properties, normalize(body.properties));
    return json(200, page);
  }
  if (m === "PATCH" && (mm = p.match(/^\/blocks\/([^/]+)\/children$/))) { (store.blocks[decodeURIComponent(mm[1])] ||= []).push(...body.children); return json(200, {}); }
  return json(400, { code: "unsupported", message: `${m} ${p}` });
};

// ---- In-memory consent store (append-only, unique per submission) ----
export const audit = [];
const audMod = await import(path.join(ROOT, "lib/audit.js"));
audMod._setSqlForTests((strings, ...vals) => {
  const q = strings.join("?");
  if (/^CREATE TABLE/.test(q.trim())) return Promise.resolve([]);
  if (/INSERT INTO pilot_consent_records/.test(q)) {
    const sid = vals[1];
    if (audit.some((r) => r.submission_id === sid)) return Promise.resolve([]);
    audit.push({ submission_ref: vals[0], submission_id: sid, org_name: vals[2], email: vals[4], terms_version: vals[6], authority_text: vals[10], marketing: vals[11] });
    return Promise.resolve([{ id: audit.length }]);
  }
  return Promise.reject(new Error("unexpected SQL"));
});

const handlers = {};
for (const n of ["leads", "pilot-register", "lead-action", "health", "config"]) handlers[n] = (await import(path.join(ROOT, `api/${n}.js`))).default;

const TYPES = { ".html": "text/html; charset=utf-8", ".png": "image/png", ".webp": "image/webp", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".txt": "text/plain" };
http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/__e2e/state") { const { outbox } = await import(path.join(ROOT, "lib/email.js")); res.setHeader("Content-Type", "application/json"); return res.end(JSON.stringify({ notion: { main: store["ds-main"], blocks: store.blocks, calls: store.calls }, audit, outbox })); }
  if (u.pathname === "/__e2e/quote") { const { quote } = await import(path.join(ROOT, "lib/pricing.js")); res.setHeader("Content-Type", "application/json"); return res.end(JSON.stringify(quote(+u.searchParams.get("n")))); }
  if (u.pathname === "/__e2e/fail-next") { failNext = u.searchParams.get("what"); return res.end("ok"); }
  if (u.pathname.startsWith("/api/")) {
    const name = u.pathname.slice(5);
    const h = handlers[name]; if (!h) { res.statusCode = 404; return res.end("{}"); }
    let raw = ""; for await (const c of req) raw += c;
    req.body = raw ? (() => { try { return JSON.parse(raw); } catch { return raw; } })() : undefined;
    res.status = (s) => { res.statusCode = s; return res; };
    res.send = (b) => res.end(b);
    if (failNext === "notion" ) { failNext = null; const f = globalThis.fetch; globalThis.fetch = async (url, o) => { if (String(url).includes("api.notion.com")) { globalThis.fetch = f; return new Response(JSON.stringify({ code: "service_unavailable", message: "simulated outage" }), { status: 503 }); } return f(url, o); }; }
    return h(req, res);
  }
  let f = path.join(ROOT, "public", u.pathname === "/" ? "index.html" : decodeURIComponent(u.pathname));
  if (!f.startsWith(path.join(ROOT, "public")) || !fs.existsSync(f)) { res.statusCode = 404; return res.end("not found"); }
  let data = fs.readFileSync(f);
  if (GATE_OPEN && f.endsWith("index.html")) data = Buffer.from(String(data).replace(DRAFT.terms, legal.LEGAL.terms.version).replace(DRAFT.privacy, legal.LEGAL.privacy.version).replace('"status": "draft"', '"status": "approved"'));
  res.setHeader("Content-Type", TYPES[path.extname(f)] || "application/octet-stream");
  res.end(data);
}).listen(PORT, () => console.log(`e2e server on http://localhost:${PORT} (pilot gate ${GATE_OPEN ? "OPEN (simulated approval)" : "CLOSED (as in production)"})`));
let failNext = null;
