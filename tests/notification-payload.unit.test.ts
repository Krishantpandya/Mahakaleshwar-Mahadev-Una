import assert from "node:assert/strict";
import { test } from "node:test";
import { toPushPreview } from "../src/notifications/payload.js";

test("push previews normalize whitespace and remain within the payload budget", () => {
  assert.equal(toPushPreview("  Har   Har\nMahadev  "), "Har Har Mahadev");
  assert.equal(toPushPreview("Short message"), "Short message");
  const longMessage = "A".repeat(5000);
  const preview = toPushPreview(longMessage);
  assert.equal(preview.length, 180);
  assert.equal(preview.endsWith("..."), true);
});
