import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { JSDOM } from "jsdom";

// __dirname replacement in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve dist directory relative to current working package
const distDir = path.resolve(process.cwd(), "dist");
const publicDir = path.resolve(process.cwd(), "public");
const publicFile = path.join(publicDir, "index.html");
const distFile = path.join(distDir, "index.html");
const tmplFile = path.join(distDir, "index.html.tmpl");

if (!fs.existsSync(publicFile)) {
  console.error(`Missing ${publicFile}`);
  process.exit(1);
}
if (!fs.existsSync(distFile)) {
  console.error(`Missing ${distFile}`);
  process.exit(1);
}

// Read both files as raw text
const publicHtml = fs.readFileSync(publicFile, "utf-8");
const distHtml = fs.readFileSync(distFile, "utf-8");

// Use JSDOM to parse dist/index.html
const dom = new JSDOM(distHtml);
const document = dom.window.document;

// Extract all <script> tags
const scripts = Array.from(document.querySelectorAll("script"))
  .map((s) => s.outerHTML)
  .join("\n");

// Inject them at the end of <head> in public/index.html
const mergedHtml = publicHtml.replace(/<\/head>/i, `${scripts}\n</head>`);

// Save merged file as dist/index.html.tmpl
fs.writeFileSync(tmplFile, mergedHtml);
