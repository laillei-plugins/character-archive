import assert from "node:assert/strict";
import { test } from "node:test";
import { exportShareNoteImages } from "../src/share/shareImages.ts";

test("note images stay private until the share option is enabled", async () => {
  let scanned = 0;
  let encoded = 0;
  const base = {
    noteTitle: "Rin",
    cover: "b.png",
    coverDataUrl: "cover-bytes",
    candidates: () => { scanned++; return ["a.png", "b.png", "c.png"]; },
    key: (image: string) => image,
    encode: async (image: string) => { encoded++; return `${image}-bytes`; },
    label: (image: string) => image,
  };

  assert.deepEqual(await exportShareNoteImages({ ...base, include: false }), {
    dataUrls: [], coverIndex: -1,
  });
  assert.equal(scanned, 0);
  assert.equal(encoded, 0);

  assert.deepEqual(await exportShareNoteImages({ ...base, include: true }), {
    dataUrls: ["a.png-bytes", "cover-bytes", "c.png-bytes"],
    coverIndex: 1,
  });
  assert.equal(scanned, 1);
  assert.equal(encoded, 2, "the cover data is reused without another image read");
});

test("a failed opted-in image names its note and position", async () => {
  await assert.rejects(
    exportShareNoteImages({
      include: true,
      noteTitle: "Rin",
      cover: null,
      coverDataUrl: null,
      candidates: () => ["a.png", "missing.png"],
      key: (image) => image,
      encode: async (image) => image === "missing.png" ? null : "bytes",
      label: (image) => image,
    }),
    /Rin.*이미지 2.*missing\.png/,
  );
});
