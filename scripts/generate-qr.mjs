// Usage: node scripts/generate-qr.mjs https://your-final-domain/path
// Produces print-ready QR codes in ./qr: vector SVG + 4096px PNG (navy on white, high error correction).
import QRCode from "qrcode";
import { mkdirSync, writeFileSync } from "node:fs";

const raw = process.argv[2];
if (!raw) { console.error("Pass the final public HTTPS URL."); process.exit(1); }
const url = new URL(raw);
if (url.protocol !== "https:") { console.error("URL must be HTTPS."); process.exit(1); }
if (!url.searchParams.has("utm_source")) {
  url.searchParams.set("utm_source", "launched2026");
  url.searchParams.set("utm_medium", "qr");
}
const target = url.toString();
const opts = { errorCorrectionLevel: "H", margin: 4, color: { dark: "#0B1B33", light: "#FFFFFF" } };

mkdirSync("qr", { recursive: true });
writeFileSync("qr/chess-magic-launched-qr.svg", await QRCode.toString(target, { ...opts, type: "svg" }));
await QRCode.toFile("qr/chess-magic-launched-qr-4096.png", target, { ...opts, width: 4096 });
console.log("QR target:", target);
console.log("Wrote qr/chess-magic-launched-qr.svg (vector) and qr/chess-magic-launched-qr-4096.png");
