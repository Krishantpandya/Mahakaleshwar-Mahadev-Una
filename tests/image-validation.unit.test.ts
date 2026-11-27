import assert from "node:assert/strict";
import { test } from "node:test";
import { matchesImageSignature } from "../src/storage/image-validation.js";

test("accepts matching JPEG, PNG, WebP, and AVIF signatures", () => {
  const cases: Array<[string, Buffer]> = [
    ["image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0x00])],
    ["image/png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    ["image/webp", Buffer.from("RIFF0000WEBP", "ascii")],
    ["image/avif", Buffer.from("0000ftypavif0000mif1", "ascii")]
  ];

  for (const [mimeType, bytes] of cases) {
    assert.equal(matchesImageSignature(bytes, mimeType), true, mimeType);
  }
});

test("rejects mismatched, truncated, empty, and unsupported image content", () => {
  assert.equal(matchesImageSignature(Buffer.from("<svg></svg>"), "image/png"), false);
  assert.equal(matchesImageSignature(Buffer.from([0xff, 0xd8]), "image/jpeg"), false);
  assert.equal(matchesImageSignature(Buffer.alloc(0), "image/webp"), false);
  assert.equal(matchesImageSignature(Buffer.from("anything"), "image/gif"), false);
  assert.equal(matchesImageSignature(Buffer.from("0000ftypmif1"), "image/avif"), false);
});
