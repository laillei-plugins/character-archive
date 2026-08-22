import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { UPDATE_NOTES_VERSION } from "../src/data/updateNotes.ts";

const root = join(import.meta.dirname, "..");

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, path), "utf8")) as Record<
    string,
    unknown
  >;
}

test("release version stays synchronized across every owner", () => {
  const packageJson = readJson("package.json");
  const manifest = readJson("manifest.json");
  const versions = readJson("versions.json");
  const version = packageJson.version;

  assert.equal(typeof version, "string");
  assert.equal(manifest.version, version);
  assert.equal(UPDATE_NOTES_VERSION, version);
  assert.equal(Object.keys(versions).at(-1), version);
  assert.equal(versions[String(version)], manifest.minAppVersion);
});

test("gallery FileView hides the native view-header so the top tab bar cannot crack", () => {
  const css = readFileSync(join(root, "styles.css"), "utf8");
  assert.match(
    css,
    /\.workspace-leaf-content\[data-type="charinfo-gallery"\]\s*>\s*\.view-header\s*\{[^}]*display:\s*none/,
  );
});

test("test-vault deploy is background-only unless reload is explicit", () => {
  const packageJson = readJson("package.json");
  const scripts = packageJson.scripts as Record<string, string>;
  const deploy = readFileSync(join(root, "scripts/deploy.mjs"), "utf8");

  assert.equal(scripts.deploy, "node scripts/deploy.mjs");
  assert.equal(scripts["deploy:reload"], "node scripts/deploy.mjs --reload");
  assert.equal(scripts["deploy:copy"], "node scripts/deploy.mjs --no-build");
  assert.match(
    deploy,
    /const doReload = args\.has\("--reload"\) && !args\.has\("--no-reload"\);/,
  );
  assert.doesNotMatch(deploy, /const doReload = !args\.has\("--no-reload"\);/);

  // `.cursor/` is intentionally excluded from the public mirror.
  const rulePath = join(root, ".cursor/rules/deploy-reload.mdc");
  if (existsSync(rulePath)) {
    const rule = readFileSync(rulePath, "utf8");
    assert.doesNotMatch(rule, /deploy \+ reload ran/);
    assert.match(rule, /npm run deploy:reload/);
  }
});
