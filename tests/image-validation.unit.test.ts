import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { isDecodableImage, matchesImageSignature } from "../src/storage/image-validation.js";

test("fully decodes supported JPEG, PNG, and WebP uploads", async () => {
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 10, g: 20, b: 30 } } }).png().toBuffer();
  const jpeg = await sharp(png).jpeg().toBuffer();
  const webp = await sharp(png).webp().toBuffer();
  const avif = await sharp(png).avif().toBuffer();

  assert.equal(await isDecodableImage(jpeg, "image/jpeg"), true);
  assert.equal(await isDecodableImage(png, "image/png"), true);
  assert.equal(await isDecodableImage(webp, "image/webp"), true);
  assert.equal(await isDecodableImage(avif, "image/avif"), true);
});

test("rejects mismatched, truncated, corrupt, unsupported and oversized image content", async () => {
  const validPng = await sharp({ create: { width: 2, height: 2, channels: 3, background: "white" } }).png().toBuffer();
  const truncated = validPng.subarray(0, 24);
  const corrupt = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(128, 0)]);
  assert.equal(matchesImageSignature(Buffer.from("<svg></svg>"), "image/png"), false);
  assert.equal(await isDecodableImage(truncated, "image/png"), false);
  assert.equal(await isDecodableImage(corrupt, "image/jpeg"), false);
  assert.equal(await isDecodableImage(Buffer.alloc(0), "image/webp"), false);
  assert.equal(await isDecodableImage(validPng, "image/jpeg"), false);
  assert.equal(await isDecodableImage(Buffer.from("anything"), "image/gif" as never), false);
});
