import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const outDir = path.join(root, "public");

const staticEntries = [
  ".nojekyll",
  "_headers",
  "admin",
  "app.js",
  "assets",
  "denoise-integration.js",
  "favicon.svg",
  "images.png",
  "index.html",
  "libai-logo-pixel.svg",
  "libai-logo.png",
  "mentor-timer",
  "nfc",
  "pricing.css",
  "pricing.html",
  "pricing.js",
  "print",
  "review-helper.css",
  "review-helper.html",
  "review-helper.js",
  "review.html",
  "security-canvas.js",
  "styles.css",
  "worker.js",
  "your-reward-code.png",
];

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

for (const entry of staticEntries) {
  const from = path.join(root, entry);
  const to = path.join(outDir, entry);

  if (!fs.existsSync(from)) {
    throw new Error(`Missing static entry: ${entry}`);
  }

  const stat = fs.statSync(from);
  if (stat.isDirectory()) {
    fs.cpSync(from, to, { recursive: true });
  } else {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
}

console.log(`Built static site into ${path.relative(root, outDir)}`);
