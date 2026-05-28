const fs = require("fs");
const path = require("path");

const targetPath = path.join(
  process.cwd(),
  "node_modules",
  "aniwatch",
  "dist",
  "index.js",
);

const defaultSourceUrl = "https://aniwaves.ru";
const configuredSourceUrl =
  process.env.ANIWATCH_SOURCE_URL ||
  (process.env.ANIWATCH_DOMAIN
    ? `https://${process.env.ANIWATCH_DOMAIN}`
    : defaultSourceUrl);
const desiredSourceUrl = new URL(configuredSourceUrl);
const desiredDomain = desiredSourceUrl.host;
const desiredReferer =
  process.env.ANIWATCH_REFERER || desiredSourceUrl.origin + "/";

function log(message) {
  process.stdout.write(`[patch-aniwatch] ${message}\n`);
}

if (!fs.existsSync(targetPath)) {
  log(`skipping: ${targetPath} was not found`);
  process.exit(0);
}

const original = fs.readFileSync(targetPath, "utf8");

const next = original
  .replace(/var DOMAIN = "[^"]+";/, `var DOMAIN = "${desiredDomain}";`)
  .replace(
    /\{\s*headers:\s*\{\s*Referer:\s*"https:\/\/[^"]+\/"\s*\}\s*\}/,
    `{ headers: { Referer: "${desiredReferer}" } }`,
  );

if (next === original) {
  log("no changes were required");
  process.exit(0);
}

fs.writeFileSync(targetPath, next, "utf8");
log(`patched aniwatch upstream to ${desiredDomain}`);
