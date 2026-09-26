import assert from "node:assert/strict";
import { test } from "node:test";

import {
  fileFingerprint,
  isStableSchemaScan,
  needsSchemaScan,
  normalizeSchemaScanCache,
} from "../src/data/schemaScanCache.ts";

test("a note edited during the scan stays eligible for another scan", () => {
  assert.equal(isStableSchemaScan("100:42", "101:42"), false);
  assert.equal(isStableSchemaScan("100:42", "100:43"), false);
  assert.equal(isStableSchemaScan("100:42", "100:42"), true);
  const files = { "Archive/A.md": "99:42" };
  if (!isStableSchemaScan("100:42", "101:42")) delete files["Archive/A.md"];
  assert.equal(needsSchemaScan({ signature: "v1", files }, "v1", "Archive/A.md", "101:42"), true);
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
