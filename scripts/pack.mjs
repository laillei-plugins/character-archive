#!/usr/bin/env node
/**
 * Build the install folder other people can drop into Obsidian:
 *   dist/character-archive/{manifest.json, main.js, styles.css}
 *   dist/character-archive.zip
 *
 * Usage:
 *   node scripts/pack.mjs
 *   node scripts/pack.mjs --no-build
 */
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const dest = join(root, "dist", "character-archive");

if (!args.has("--no-build")) {
  const build = spawnSync("npm", ["run", "build"], {
    cwd: root,
    stdio: "inherit",
  });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });

for (const file of ["main.js", "styles.css", "manifest.json"]) {
  const src = join(root, file);
  if (!existsSync(src)) {
    console.error(`missing ${file} — build first`);
    process.exit(1);
  }
  copyFileSync(src, join(dest, file));
}

const zipPath = join(root, "dist", "character-archive.zip");
rmSync(zipPath, { force: true });
const zip = spawnSync("zip", ["-q", "-r", "character-archive.zip", "character-archive"], {
  cwd: join(root, "dist"),
  stdio: "inherit",
});
if (zip.status !== 0) {
  console.warn("zip skipped — folder is at dist/character-archive");
} else {
  console.log(`packed → ${zipPath}`);
}
console.log(`folder → ${dest}`);
