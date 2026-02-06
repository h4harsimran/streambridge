#!/usr/bin/env node
/**
 * Bump patch version (1.2.X → 1.2.X+1) in package.json and readme.md.
 * Run before commit: npm run version:patch
 */

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const pkgPath = path.join(root, "package.json");
const readmePath = path.join(root, "readme.md");

const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const parts = pkg.version.split(".").map(Number);
if (parts.length !== 3 || parts.some(isNaN)) {
  console.error("Invalid version in package.json:", pkg.version);
  process.exit(1);
}
parts[2] += 1;
const newVersion = parts.join(".");

pkg.version = newVersion;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
console.log("package.json →", newVersion);

const readme = fs.readFileSync(readmePath, "utf8");
const badgeRe = /(!\[Version\]\(https:\/\/img\.shields\.io\/badge\/version-)([\d.]+)(-blue\.svg\))/;
if (badgeRe.test(readme)) {
  const updated = readme.replace(badgeRe, `$1${newVersion}$3`);
  fs.writeFileSync(readmePath, updated, "utf8");
  console.log("readme.md (badge) →", newVersion);
} else {
  console.warn("readme.md: version badge pattern not found, skipped");
}

console.log("Done. Version is now", newVersion);
