import assert from "node:assert/strict";
import { createHash, randomUUID, randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { after, before, test } from "node:test";
import { buildApp } from "../src/app.js";
import { database } from "../src/database.js";
import { enqueueNotification, processNotificationOutbox } from "../src/notifications/outbox.js";

const scrypt = promisify(scryptCallback);

if (!database) throw new Error("DATABASE_URL must be set for integration tests");

const app = buildApp();

before(async () => {
  await app.ready();
});

after(async () => {
  await app.close();
});

test("readiness endpoint verifies the database connection", async () => {
  const response = await app.inject({ method: "GET", url: "/api/v1/ready" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: "ready", database: "connected" });
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

test("push subscription upsert replaces channel selections atomically and rejects unsafe endpoints", async () => {
  const endpoint = `https://fcm.googleapis.com/subscription/${randomUUID()}`;
  const payload = {
    endpoint,
    keys: { p256dh: "AbCdEf0123456789_-", auth: "AbCdEf0123456789_-" },
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

    for (const unsafeEndpoint of [
      "http://push.example.test/subscription",
      "https://localhost/subscription",
      "https://127.0.0.1/subscription",
      "https://user:pass@fcm.googleapis.com/subscription",
      "https://attacker.example.test/subscription"
    ]) {
      const unsafe = await app.inject({
        method: "PUT", url: "/api/v1/push-subscriptions",
        payload: { ...payload, endpoint: unsafeEndpoint }
      });
      assert.equal(unsafe.statusCode, 400, `unsafe endpoint should be rejected: ${unsafeEndpoint}`);
    }
  } finally {
    await database.query("DELETE FROM push_subscriptions WHERE endpoint = $1", [endpoint]);
  }
});

test("published notifications are persisted in the retryable outbox", async () => {
  const payload = {
    title: "Outbox integration test",
    body: "A queued notification",
    url: "/"
  };
  await enqueueNotification("photos", payload);
  const stored = await database.query(
    "SELECT channel, payload, attempts, delivered_at FROM notification_outbox " +
    "WHERE payload->>'title' = $1 ORDER BY created_at DESC LIMIT 1",
    [payload.title]
  );
  assert.equal(stored.rowCount, 1);
  assert.equal(stored.rows[0].channel, "photos");
  assert.deepEqual(stored.rows[0].payload, payload);
  assert.equal(stored.rows[0].attempts, 0);
  assert.equal(stored.rows[0].delivered_at, null);
  await database.query("DELETE FROM notification_outbox WHERE payload->>'title' = $1", [payload.title]);
});

test("content and its notification outbox row roll back as one transaction", async () => {
  const announcementId = randomUUID();
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO announcements (id, title, message, published_at) VALUES ($1, $2, $3, NOW())",
      [announcementId, "Atomicity test", "This row must roll back"]
    );
    await client.query(
      "INSERT INTO notification_outbox (channel, payload) VALUES ($1, $2::jsonb)",
      ["announcements", JSON.stringify({
        title: "Atomicity test",
        body: "This outbox row must roll back",
        url: "/"
      })]
    );
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }

  const announcement = await database.query(
    "SELECT id FROM announcements WHERE id = $1",
    [announcementId]
  );
  const notification = await database.query(
    "SELECT id FROM notification_outbox WHERE payload->>'title' = $1",
    ["Atomicity test"]
  );
  assert.equal(announcement.rowCount, 0);
  assert.equal(notification.rowCount, 0);
});

test("notification worker marks successful delivery and retries failures with bounded attempts", async () => {
  const successTitle = "Worker success " + randomUUID();
  const failedTitle = "Worker retry " + randomUUID();
  const deadTitle = "Worker dead-letter " + randomUUID();

  const success = await database.query(
    "INSERT INTO notification_outbox (channel, payload) VALUES ($1, $2::jsonb) RETURNING id",
    ["photos", JSON.stringify({ title: successTitle, body: "success", url: "/" })]
  );
  const failed = await database.query(
    "INSERT INTO notification_outbox (channel, payload) VALUES ($1, $2::jsonb) RETURNING id",
    ["photos", JSON.stringify({ title: failedTitle, body: "failure", url: "/" })]
  );
  const dead = await database.query(
    "INSERT INTO notification_outbox (channel, payload, attempts) VALUES ($1, $2::jsonb, 9) RETURNING id",
    ["photos", JSON.stringify({ title: deadTitle, body: "dead letter", url: "/" })]
  );

  try {
    await processNotificationOutbox(
      app.log,
      async () => ({ attempted: 1, sent: 1, failed: 0 }),
      () => true
    );
    const successState = await database.query(
      "SELECT delivered_at FROM notification_outbox WHERE id = $1",
      [success.rows[0].id]
    );
    assert.ok(successState.rows[0].delivered_at);

    // Re-arm the two failure cases after the success batch.
    await database.query(
      "UPDATE notification_outbox SET delivered_at = NULL, dead_at = NULL, claimed_at = NULL, available_at = NOW(), attempts = 0 WHERE id = $1",
      [failed.rows[0].id]
    );
    await database.query(
      "UPDATE notification_outbox SET delivered_at = NULL, dead_at = NULL, claimed_at = NULL, available_at = NOW() WHERE id = $1",
      [dead.rows[0].id]
    );
    await processNotificationOutbox(
      app.log,
      async () => ({ attempted: 1, sent: 0, failed: 1 }),
      () => true
    );

    const retryState = await database.query(
      "SELECT attempts, available_at, dead_at, last_error FROM notification_outbox WHERE id = $1",
      [failed.rows[0].id]
    );
    assert.equal(retryState.rows[0].attempts, 1);
    assert.ok(new Date(retryState.rows[0].available_at).getTime() > Date.now());
    assert.equal(retryState.rows[0].dead_at, null);
    assert.match(retryState.rows[0].last_error, /failed for 1 subscription/);

    const deadState = await database.query(
      "SELECT attempts, dead_at FROM notification_outbox WHERE id = $1",
      [dead.rows[0].id]
    );
    assert.equal(deadState.rows[0].attempts, 10);
    assert.ok(deadState.rows[0].dead_at);
  } finally {
    await database.query(
      "DELETE FROM notification_outbox WHERE id = ANY($1::uuid[])",
      [[success.rows[0].id, failed.rows[0].id, dead.rows[0].id]]
    );
  }
});

test("notification outbox claims are concurrency-safe and stale claims can be recovered", async () => {
  const title = "Outbox claim concurrency " + randomUUID();
  const inserted = await database.query(
    "INSERT INTO notification_outbox (channel, payload) VALUES ($1, $2::jsonb) RETURNING id",
    ["photos", JSON.stringify({ title, body: "claim test", url: "/" })]
  );
  const notificationId = inserted.rows[0].id as string;
  const first = await database.connect();
  const second = await database.connect();
  try {
    await first.query("BEGIN");
    const firstClaim = await first.query(
      "SELECT id FROM notification_outbox WHERE id = $1 AND delivered_at IS NULL AND dead_at IS NULL " +
      "AND (claimed_at IS NULL OR claimed_at < NOW() - INTERVAL '5 minutes') FOR UPDATE SKIP LOCKED",
      [notificationId]
    );
    assert.equal(firstClaim.rowCount, 1);

    await second.query("BEGIN");
    const secondClaim = await second.query(
      "SELECT id FROM notification_outbox WHERE id = $1 AND delivered_at IS NULL AND dead_at IS NULL " +
      "AND (claimed_at IS NULL OR claimed_at < NOW() - INTERVAL '5 minutes') FOR UPDATE SKIP LOCKED",
      [notificationId]
    );
    assert.equal(secondClaim.rowCount, 0);
    await first.query("UPDATE notification_outbox SET claimed_at = NOW() WHERE id = $1", [notificationId]);
    await first.query("COMMIT");
    await second.query("COMMIT");

    await database.query(
      "UPDATE notification_outbox SET claimed_at = NOW() - INTERVAL '6 minutes' WHERE id = $1",
      [notificationId]
    );
    const recovered = await database.query(
      "SELECT id FROM notification_outbox WHERE id = $1 AND delivered_at IS NULL AND dead_at IS NULL " +
      "AND (claimed_at IS NULL OR claimed_at < NOW() - INTERVAL '5 minutes') FOR UPDATE SKIP LOCKED",
      [notificationId]
    );
    assert.equal(recovered.rowCount, 1);
  } catch (error) {
    await first.query("ROLLBACK").catch(() => undefined);
    await second.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    first.release();
    second.release();
    await database.query("DELETE FROM notification_outbox WHERE id = $1", [notificationId]);
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

    const untrustedLogin = await app.inject({
      method: "POST", url: "/api/v1/admin/auth/login",
      headers: { origin: "https://attacker.example.test" },
      payload: { email, password }
    });
    assert.equal(untrustedLogin.statusCode, 403);

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

    const boundary = "----mankaleshwar-integration-boundary";
    const announcementBody = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="title"',
      "",
      "Integration announcement",
      `--${boundary}`,
      'Content-Disposition: form-data; name="message"',
      "",
      "This announcement is published through the admin API test.",
      `--${boundary}--`,
      ""
    ].join("\r\n");
    const announcementResponse = await app.inject({
      method: "POST",
      url: "/api/v1/admin/announcements",
      headers: {
        origin: "http://localhost:5173",
        "content-type": `multipart/form-data; boundary=${boundary}`
      },
      cookies: { mankaleshwar_admin_session: cookie.value },
      payload: announcementBody
    });
    assert.equal(announcementResponse.statusCode, 201);
    const announcementId = announcementResponse.json<{ data: { id: string } }>().data.id;
    const announcementOutbox = await database.query(
      "SELECT channel, payload FROM notification_outbox WHERE payload->>'title' = $1",
      ["Integration announcement"]
    );
    assert.equal(announcementOutbox.rowCount, 1);
    assert.equal(announcementOutbox.rows[0].channel, "announcements");
    await database.query("DELETE FROM announcements WHERE id = $1", [announcementId]);
    await database.query(
      "DELETE FROM notification_outbox WHERE payload->>'title' = $1",
      ["Integration announcement"]
    );

    const unavailablePhotoUpload = await app.inject({
      method: "POST",
      url: "/api/v1/admin/photos",
      headers: {
        origin: "http://localhost:5173",
        "content-type": `multipart/form-data; boundary=${boundary}`
      },
      cookies: { mankaleshwar_admin_session: cookie.value },
      payload: `--${boundary}--\r\n`
    });
    assert.equal(unavailablePhotoUpload.statusCode, 503);

    const me = await app.inject({
      method: "GET", url: "/api/v1/admin/auth/me",
      cookies: { mankaleshwar_admin_session: cookie.value }
    });
    assert.equal(me.statusCode, 200);
    assert.equal(me.json<{ admin: { email: string } }>().admin.email, email);

    const expiredToken = randomBytes(32).toString("base64url");
    const expiredHash = createHash("sha256").update(expiredToken).digest("hex");
    await database.query(
      "INSERT INTO admin_sessions (admin_id, token_hash, expires_at) VALUES ($1, $2, NOW() - INTERVAL '1 minute')",
      [adminId, expiredHash]
    );
    const expiredSession = await app.inject({
      method: "GET", url: "/api/v1/admin/auth/me",
      cookies: { mankaleshwar_admin_session: expiredToken }
    });
    assert.equal(expiredSession.statusCode, 401);

    const blockedLogout = await app.inject({
      method: "POST", url: "/api/v1/admin/auth/logout",
      headers: { origin: "https://attacker.example.test" },
      cookies: { mankaleshwar_admin_session: cookie.value }
    });
    assert.equal(blockedLogout.statusCode, 403);

    const logout = await app.inject({
      method: "POST", url: "/api/v1/admin/auth/logout",
      headers: { origin: "http://localhost:5173" },
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
