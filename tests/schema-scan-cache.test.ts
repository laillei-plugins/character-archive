import assert from "node:assert/strict";
import { test } from "node:test";

import {
  fileFingerprint,
  isStableSchemaScan,
  loadDeviceSchemaScanCache,
  needsSchemaScan,
  normalizeSchemaScanCache,
  saveDeviceSchemaScanCache,
} from "../src/data/schemaScanCache.ts";

test("a note edited during the scan stays eligible for another scan", () => {
  assert.equal(isStableSchemaScan("100:42", "101:42"), false);
  assert.equal(isStableSchemaScan("100:42", "100:43"), false);
  assert.equal(isStableSchemaScan("100:42", "100:42"), true);
  const files = { "Archive/A.md": "99:42" };
  if (!isStableSchemaScan("100:42", "101:42")) delete files["Archive/A.md"];
  assert.equal(needsSchemaScan({ signature: "v1", files }, "v1", "Archive/A.md", "101:42"), true);
});

const sample = { signature: "schema-v1", files: { "Archive/A.md": "100:42" } };

test("device cache uses vault-local app storage with the app receiver", () => {
  const app = {
    values: new Map<string, unknown>(),
    loadLocalStorage(key: string) { return this.values.get(key); },
    saveLocalStorage(key: string, value: unknown) { this.values.set(key, value); },
  };
  const unavailable = () => { throw new Error("fallback must not be used"); };
  assert.deepEqual(loadDeviceSchemaScanCache(app, unavailable), { signature: "", files: {} });
  saveDeviceSchemaScanCache(app, sample, unavailable);
  assert.deepEqual(loadDeviceSchemaScanCache(app, unavailable), sample);
  assert.equal(app.values.size, 1);
});

test("older app fallback persists JSON separately for each vault appId", () => {
  const values = new Map<string, string>();
  const storage = () => ({
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  });
  const first = { appId: "vault-one", loadLocalStorage: undefined };
  const second = { appId: "vault-two", loadLocalStorage: undefined };
  saveDeviceSchemaScanCache(first, sample, storage);
  assert.deepEqual(loadDeviceSchemaScanCache(first, storage), sample);
  assert.deepEqual(loadDeviceSchemaScanCache(second, storage), { signature: "", files: {} });
  saveDeviceSchemaScanCache(second, { signature: "other", files: {} }, storage);
  assert.equal(values.size, 2);
  assert.ok([...values.keys()].some((key) => key.includes(first.appId)));
  assert.deepEqual(loadDeviceSchemaScanCache(first, storage), sample);
});

test("device cache validates native and fallback data and ignores corrupt JSON", () => {
  const corrupt = { signature: 42, files: { good: "1:2", bad: "not-stats" } };
  assert.deepEqual(loadDeviceSchemaScanCache({ loadLocalStorage: () => corrupt }), {
    signature: "", files: { good: "1:2" },
  });
  const app = { appId: "vault", loadLocalStorage: undefined };
  for (const value of ["{broken", "null", "42", "[]"]) {
    assert.deepEqual(loadDeviceSchemaScanCache(app, () => ({
      getItem: () => value, setItem: () => {},
    })), { signature: "", files: {} });
  }
  assert.deepEqual(loadDeviceSchemaScanCache(app, () => ({
    getItem: () => JSON.stringify(corrupt), setItem: () => {},
  })), { signature: "", files: { good: "1:2" } });
});

test("unavailable storage and throwing app methods never fail the scan", () => {
  const unavailable = () => { throw new Error("storage denied"); };
  const app = {
    loadLocalStorage() { throw new Error("read failed"); },
    saveLocalStorage() { throw new Error("write failed"); },
  };
  assert.deepEqual(loadDeviceSchemaScanCache(app, unavailable), { signature: "", files: {} });
  assert.doesNotThrow(() => saveDeviceSchemaScanCache(app, sample, unavailable));
  assert.deepEqual(loadDeviceSchemaScanCache({}, unavailable), { signature: "", files: {} });
  assert.doesNotThrow(() => saveDeviceSchemaScanCache({}, sample, unavailable));
  const fallbackApp = { appId: "vault", loadLocalStorage: undefined };
  assert.deepEqual(loadDeviceSchemaScanCache(fallbackApp, unavailable), { signature: "", files: {} });
  assert.doesNotThrow(() => saveDeviceSchemaScanCache(fallbackApp, sample, unavailable));
});

test("fallback refuses a shared key when vault identity is missing", () => {
  let accesses = 0;
  const storage = () => ({
    getItem: () => { accesses++; return null; },
    setItem: () => { accesses++; },
  });
  assert.deepEqual(loadDeviceSchemaScanCache({}, storage), { signature: "", files: {} });
  saveDeviceSchemaScanCache({}, sample, storage);
  assert.equal(accesses, 0);
});

test("routine startup skips a successfully scanned unchanged note", () => {
  const cache = normalizeSchemaScanCache({
    signature: "schema-v1",
    files: { "Archive/A.md": "100:42" },
  });
  assert.equal(needsSchemaScan(cache, "schema-v1", "Archive/A.md", "100:42"), false);
  assert.equal(needsSchemaScan(cache, "schema-v1", "Archive/A.md", "101:42"), true);
  assert.equal(needsSchemaScan(cache, "schema-v1", "Archive/B.md", "100:42"), true);
  assert.equal(needsSchemaScan(cache, "schema-v2", "Archive/A.md", "100:42"), true);
});

test("invalid cached entries are retried and file stats determine the fingerprint", () => {
  const cache = normalizeSchemaScanCache({
    signature: "schema-v1",
    files: { "Archive/A.md": "bad", "Archive/B.md": "100:42" },
  });
  assert.deepEqual(cache.files, { "Archive/B.md": "100:42" });
  assert.equal(fileFingerprint({ mtime: 100, size: 42 }), "100:42");
  assert.equal(needsSchemaScan(cache, "schema-v1", "Archive/A.md", "100:42"), true);
});
