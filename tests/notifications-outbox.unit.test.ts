import assert from "node:assert/strict";
import { test } from "node:test";
import { getNotificationRetry } from "../src/notifications/outbox.js";

test("notification retry policy uses bounded exponential backoff", () => {
  assert.deepEqual(getNotificationRetry(0), {
    attempts: 1, terminal: false, delaySeconds: 30
  });
  assert.deepEqual(getNotificationRetry(1), {
    attempts: 2, terminal: false, delaySeconds: 60
  });
  assert.deepEqual(getNotificationRetry(2), {
    attempts: 3, terminal: false, delaySeconds: 120
  });
  assert.deepEqual(getNotificationRetry(6), {
    attempts: 7, terminal: false, delaySeconds: 1920
  });
  assert.deepEqual(getNotificationRetry(7), {
    attempts: 8, terminal: false, delaySeconds: 3600
  });
  assert.deepEqual(getNotificationRetry(9), {
    attempts: 10, terminal: true, delaySeconds: 3600
  });
});
