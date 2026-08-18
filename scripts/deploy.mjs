#!/usr/bin/env node
/**
 * Build (optional) → copy the plugin into the Obsidian vault → reload.
 *
 * Usage:
 *   node scripts/deploy.mjs           # build + copy + reload
 *   node scripts/deploy.mjs --no-build
 *   node scripts/deploy.mjs --no-reload
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function resolveVaultPluginDir() {
  const fromEnv = process.env.CHARINFO_VAULT_PLUGIN_DIR?.trim();
  if (fromEnv) return fromEnv;
  const pointer = join(root, ".vault-plugin-dir");
  if (existsSync(pointer)) {
    const line = readFileSync(pointer, "utf8")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find(Boolean);
    if (line) return line;
  }
  console.error(
    "Set CHARINFO_VAULT_PLUGIN_DIR to <vault>/.obsidian/plugins/character-archive",
  );
  console.error("or put that path in a local .vault-plugin-dir file.");
  process.exit(1);
}

const VAULT_PLUGIN = resolveVaultPluginDir();

const args = new Set(process.argv.slice(2));
const doBuild = !args.has("--no-build");
const doReload = !args.has("--no-reload");

function run(cmd, argv, opts = {}) {
  const res = spawnSync(cmd, argv, {
    cwd: root,
    stdio: "inherit",
    ...opts,
  });
  if (res.status !== 0) {
    process.exit(res.status ?? 1);
  }
}

if (doBuild) {
  run("npm", ["run", "build"]);
}

if (!existsSync(VAULT_PLUGIN)) {
  mkdirSync(VAULT_PLUGIN, { recursive: true });
}

for (const file of ["main.js", "styles.css", "manifest.json"]) {
  const src = join(root, file);
  if (!existsSync(src)) {
    console.error(`missing ${file} — build first`);
    process.exit(1);
  }
  copyFileSync(src, join(VAULT_PLUGIN, file));
}

// Nudge watchers (Hot Reload / mtime checks).
const stamp = new Date();
for (const file of ["main.js", "styles.css", "manifest.json"]) {
  utimesSync(join(VAULT_PLUGIN, file), stamp, stamp);
}
writeFileSync(join(VAULT_PLUGIN, ".deploy-stamp"), stamp.toISOString() + "\n");

console.log(`deployed → ${VAULT_PLUGIN}`);

if (!doReload) process.exit(0);

// Prefer in-app reload via command palette; fall back to relaunch.
const script = `
tell application "Obsidian" to activate
delay 0.35
tell application "System Events"
  if not (exists process "Obsidian") then return "not-running"
  keystroke "p" using {command down}
  delay 0.45
  keystroke "Reload app without saving"
  delay 0.35
  key code 36
end tell
return "ok"
`;

try {
  const out = execFileSync("osascript", ["-e", script], {
    encoding: "utf8",
    timeout: 8000,
  }).trim();
  if (out.includes("not-running")) {
    spawnSync("open", ["-a", "Obsidian"], { stdio: "inherit" });
    console.log("Obsidian was closed — launched");
  } else {
    console.log("Obsidian reload requested");
  }
} catch {
  console.warn("palette reload failed — relaunching Obsidian");
  try {
    execFileSync("osascript", ["-e", 'quit app "Obsidian"'], { timeout: 5000 });
  } catch {
    /* ignore */
  }
  spawnSync("sleep", ["1"]);
  spawnSync("open", ["-a", "Obsidian"], { stdio: "inherit" });
  console.log("Obsidian relaunched");
}
