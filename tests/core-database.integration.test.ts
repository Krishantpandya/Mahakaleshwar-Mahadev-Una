import assert from "node:assert/strict";
import { randomUUID, randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { after, before, test } from "node:test";
import { buildApp } from "../src/app.js";
import { database } from "../src/database.js";

const scrypt = promisify(scryptCallback);

if (!database) throw new Error("DATABASE_URL must be set for integration tests");

const app = buildApp();

before(async () => {
  await app.ready();
});

after(async () => {
  await app.close();
});

test("photo listing filters by upload date and guest likes are idempotent/removable", async () => {
  const photoId = randomUUID();
  const visitorId = randomUUID();
  try {
    await database.query(
      "INSERT INTO photos (id, storage_key, media_url, mime_type, published_at, uploaded_at) VALUES ($1, $2, $3, $4, NOW(), NOW())",
      [photoId, `integration-tests/${photoId}.jpg`, `https://media.example.test/${photoId}.jpg`, "image/jpeg"]
    );

    const list = await app.inject({ method: "GET", url: "/api/v1/photos?limit=10&offset=0" });
    assert.equal(list.statusCode, 200);
    assert.ok(list.json<{ data: Array<{ id: string }> }>().data.some((photo) => photo.id === photoId));

    const invalidRange = await app.inject({
      method: "GET",
      url: "/api/v1/photos?from=2026-11-28&to=2026-11-27"
    });
    assert.equal(invalidRange.statusCode, 400);

    const like = () => app.inject({
      method: "POST", url: `/api/v1/photos/${photoId}/likes`, payload: { visitorId }
    });
    const firstLike = await like();
    const secondLike = await like();
    assert.equal(firstLike.statusCode, 200);
    assert.equal(secondLike.json<{ likeCount: number }>().likeCount, 1);

    const unlike = await app.inject({
      method: "DELETE", url: `/api/v1/photos/${photoId}/likes`, payload: { visitorId }
    });
    assert.equal(unlike.statusCode, 200);
    assert.equal(unlike.json<{ liked: boolean; likeCount: number }>().liked, false);
    assert.equal(unlike.json<{ likeCount: number }>().likeCount, 0);
  } finally {
    await database.query("DELETE FROM photos WHERE id = $1", [photoId]);
  }
});

test("announcements list exposes only published records", async () => {
  const publishedId = randomUUID();
  const draftId = randomUUID();
  try {
    await database.query(
      "INSERT INTO announcements (id, title, message, published_at) VALUES ($1, $2, $3, NOW())",
      [publishedId, "Integration test", "Published announcement"]
    );
    await database.query(
      "INSERT INTO announcements (id, title, message) VALUES ($1, $2, $3)",
      [draftId, "Draft test", "Unpublished announcement"]
    );

    const response = await app.inject({ method: "GET", url: "/api/v1/announcements?limit=10" });
    assert.equal(response.statusCode, 200);
    const ids = response.json<{ data: Array<{ id: string }> }>().data.map((item) => item.id);
    assert.ok(ids.includes(publishedId));
    assert.ok(!ids.includes(draftId));
  } finally {
    await database.query("DELETE FROM announcements WHERE id = ANY($1::uuid[])", [[publishedId, draftId]]);
  }
});

test("push subscription upsert replaces channel selections atomically", async () => {
  const endpoint = `https://push.example.test/subscription/${randomUUID()}`;
  const payload = {
    endpoint,
    keys: { p256dh: "test-public-key", auth: "test-auth-key" },
    channels: ["photos", "announcements"]
  };

  try {
    const first = await app.inject({ method: "PUT", url: "/api/v1/push-subscriptions", payload });
    assert.equal(first.statusCode, 200);
    assert.deepEqual(first.json<{ subscribed: string[] }>().subscribed, ["photos", "announcements"]);

    const second = await app.inject({
      method: "PUT",
      url: "/api/v1/push-subscriptions",
      payload: { ...payload, channels: ["announcements"] }
    });
    assert.equal(second.statusCode, 200);

    const stored = await database.query(
      "SELECT channel FROM push_subscription_channels c JOIN push_subscriptions s ON s.id = c.push_subscription_id WHERE s.endpoint = $1",
      [endpoint]
    );
    assert.deepEqual(stored.rows.map((row) => row.channel), ["announcements"]);

    const invalid = await app.inject({
      method: "PUT", url: "/api/v1/push-subscriptions",
      payload: { ...payload, channels: ["photos", "photos"] }
    });
    assert.equal(invalid.statusCode, 400);
  } finally {
    await database.query("DELETE FROM push_subscriptions WHERE endpoint = $1", [endpoint]);
  }
});

test("admin sessions authenticate, reject invalid sessions, and logout revokes the session", async () => {
  const email = `integration-${randomUUID()}@example.test`;
  const password = "Integration-Test-Password-123";
  const salt = randomBytes(16).toString("hex");
  const hash = (await scrypt(password, salt, 64)) as Buffer;
  const passwordHash = `scrypt$${salt}$${hash.toString("hex")}`;
  let adminId: string | undefined;

  try {
    const inserted = await database.query(
      "INSERT INTO admins (email, password_hash) VALUES ($1, $2) RETURNING id",
      [email, passwordHash]
    );
    adminId = inserted.rows[0].id as string;

    const unauthorized = await app.inject({ method: "GET", url: "/api/v1/admin/auth/me" });
    assert.equal(unauthorized.statusCode, 401);

    const badLogin = await app.inject({
      method: "POST", url: "/api/v1/admin/auth/login",
      payload: { email, password: "incorrect-password" }
    });
    assert.equal(badLogin.statusCode, 401);

    const login = await app.inject({
      method: "POST", url: "/api/v1/admin/auth/login", payload: { email, password }
    });
    assert.equal(login.statusCode, 200);
    const cookie = login.cookies.find((item) => item.name === "mankaleshwar_admin_session");
    assert.ok(cookie?.value);

    const me = await app.inject({
      method: "GET", url: "/api/v1/admin/auth/me",
      cookies: { mankaleshwar_admin_session: cookie.value }
    });
    assert.equal(me.statusCode, 200);
    assert.equal(me.json<{ admin: { email: string } }>().admin.email, email);

    const logout = await app.inject({
      method: "POST", url: "/api/v1/admin/auth/logout",
      cookies: { mankaleshwar_admin_session: cookie.value }
    });
    assert.equal(logout.statusCode, 200);

    const revoked = await app.inject({
      method: "GET", url: "/api/v1/admin/auth/me",
      cookies: { mankaleshwar_admin_session: cookie.value }
    });
    assert.equal(revoked.statusCode, 401);
  } finally {
    if (adminId) await database.query("DELETE FROM admins WHERE id = $1", [adminId]);
  }
});
