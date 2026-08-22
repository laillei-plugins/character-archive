#!/usr/bin/env node
/**
 * Build (optional) → copy Character Archive into the Obsidian test vault.
 * Foreground reload is explicit only.
 *
 * Usage:
 *   node scripts/deploy.mjs           # build + copy, no foreground reload
 *   node scripts/deploy.mjs --no-build
 *   node scripts/deploy.mjs --reload  # explicit foreground reload
 *   node scripts/deploy.mjs --no-reload # compatibility safety override
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
import { basename, dirname, join } from "node:path";
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

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Refuse to deploy next to the pre-rename `charinfo` install: two copies of the
 * same plugin fight over views and settings. Never edits the vault config —
 * removal is the user's call, so we only print the manual steps.
 */
function assertNoLegacyInstall() {
  const pluginsDir = dirname(VAULT_PLUGIN);
  const legacyDir = join(pluginsDir, "charinfo");
  // Deploying *into* the legacy folder is the one case with nothing to collide.
  if (basename(VAULT_PLUGIN) === "charinfo") return;

  const reasons = [];
  if (existsSync(legacyDir)) {
    const manifest = readJson(join(legacyDir, "manifest.json"));
    if (manifest?.id === "charinfo") {
      reasons.push(`legacy plugin folder still installed: ${legacyDir}`);
    }
  }

  const obsidianDir = dirname(pluginsDir);
  const communityPath = join(obsidianDir, "community-plugins.json");
  const enabled = readJson(communityPath);
  if (Array.isArray(enabled) && enabled.includes("charinfo")) {
    reasons.push(`"charinfo" is still enabled in ${communityPath}`);
  }

  if (reasons.length === 0) return;

  console.error("refusing to deploy — legacy charinfo install detected:");
  for (const reason of reasons) console.error(`  · ${reason}`);
  console.error("");
  console.error("do this once in Obsidian, then re-run deploy:");
  console.error("  1. Settings → Community plugins → turn off «charinfo»");
  console.error(`  2. delete ${legacyDir}`);
  console.error(`  3. make sure ${communityPath} no longer lists "charinfo"`);
  console.error(`  4. reload Obsidian, then: npm run deploy`);
  process.exit(1);
}

assertNoLegacyInstall();

const args = new Set(process.argv.slice(2));
const doBuild = !args.has("--no-build");
const doReload = args.has("--reload") && !args.has("--no-reload");

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

// Code only. `data.json` is the user's live settings — never copy or merge it.
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
