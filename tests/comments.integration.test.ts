import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { buildApp } from "../src/app.js";
import { database } from "../src/database.js";

if (!database) throw new Error("DATABASE_URL must be set for integration tests");

const app = buildApp();
await app.ready();

after(async () => {
  await app.close();
});

test("published photo comments support presets, custom text, and immediate listing", async () => {
  const photoId = randomUUID();
  const visitorId = randomUUID();

  try {
    await database.query(
      "INSERT INTO photos (id, storage_key, mime_type, published_at) VALUES ($1, $2, $3, NOW())",
      [photoId, `integration-tests/${photoId}.jpg`, "image/jpeg"]
    );

    const presetsResponse = await app.inject({
      method: "GET",
      url: "/api/v1/comments/predefined"
    });
    assert.equal(presetsResponse.statusCode, 200);
    const presets = presetsResponse.json<{ data: Array<{ id: string; body: string }> }>();
    const harHarMahadev = presets.data.find((item) => item.body === "Har Har Mahadev");
    assert.ok(harHarMahadev, "the confirmed seed comment should be available");

    const presetResponse = await app.inject({
      method: "POST",
      url: `/api/v1/photos/${photoId}/comments`,
      payload: { visitorId, predefinedCommentId: harHarMahadev.id }
    });
    assert.equal(presetResponse.statusCode, 201);
    assert.equal(presetResponse.json<{ data: { body: string } }>().data.body, "Har Har Mahadev");

    const customResponse = await app.inject({
      method: "POST",
      url: `/api/v1/photos/${photoId}/comments`,
      payload: { visitorId, body: "A custom visitor comment" }
    });
    assert.equal(customResponse.statusCode, 201);
    assert.equal(customResponse.json<{ data: { body: string } }>().data.body, "A custom visitor comment");

    const listResponse = await app.inject({
      method: "GET",
      url: `/api/v1/photos/${photoId}/comments?limit=10&offset=0`
    });
    assert.equal(listResponse.statusCode, 200);
    const comments = listResponse.json<{ data: Array<{ body: string }>; pagination: { returned: number } }>();
    assert.equal(comments.pagination.returned, 2);
    assert.deepEqual(new Set(comments.data.map((item) => item.body)), new Set([
      "Har Har Mahadev",
      "A custom visitor comment"
    ]));

    const invalidResponse = await app.inject({
      method: "POST",
      url: `/api/v1/photos/${photoId}/comments`,
      payload: { visitorId, body: "   " }
    });
    assert.equal(invalidResponse.statusCode, 400);
  } finally {
    await database.query("DELETE FROM photos WHERE id = $1", [photoId]);
  }
});
