import type { FastifyBaseLogger } from "fastify";
import { database } from "../database.js";
import { isPushConfigured, notifyChannel, type NotificationChannel } from "./web-push.js";

type NotificationPayload = { title: string; body: string; url: string };
type OutboxRow = {
  id: string;
  channel: NotificationChannel;
  payload: NotificationPayload;
  attempts: number;
};

export function getNotificationRetry(attemptsSoFar: number): {
  attempts: number;
  terminal: boolean;
  delaySeconds: number;
} {
  const attempts = attemptsSoFar + 1;
  return {
    attempts,
    terminal: attempts >= 10,
    delaySeconds: Math.min(3600, 30 * (2 ** Math.min(attempts - 1, 7)))
  };
}

export async function enqueueNotification(
  channel: NotificationChannel,
  payload: NotificationPayload
): Promise<void> {
  if (!database) throw new Error("Cannot queue notification without a database");
  await database.query(
    "INSERT INTO notification_outbox (channel, payload) VALUES ($1, $2::jsonb)",
    [channel, JSON.stringify(payload)]
  );
}

let processing = false;

export async function processNotificationOutbox(logger: FastifyBaseLogger): Promise<void> {
  if (!database || !isPushConfigured() || processing) return;
  processing = true;
  try {
    const client = await database.connect();
    let rows: OutboxRow[] = [];
    try {
      await client.query("BEGIN");
      const claimed = await client.query<OutboxRow>(
        "SELECT id, channel, payload, attempts FROM notification_outbox " +
        "WHERE delivered_at IS NULL AND dead_at IS NULL AND available_at <= NOW() " +
        "AND (claimed_at IS NULL OR claimed_at < NOW() - INTERVAL '5 minutes') " +
        "ORDER BY created_at ASC LIMIT 20 FOR UPDATE SKIP LOCKED"
      );
      rows = claimed.rows;
      if (rows.length) {
        await client.query(
          "UPDATE notification_outbox SET claimed_at = NOW() WHERE id = ANY($1::uuid[])",
          [rows.map((row) => row.id)]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    for (const row of rows) {
      try {
        const result = await notifyChannel(row.channel, row.payload, logger);
        if (result.skipped || result.failed > 0) {
          throw new Error(result.skipped
            ? "Push delivery is not configured; notification remains queued"
            : `Push delivery failed for ${result.failed} subscription(s)`);
        }
        await database.query(
          "UPDATE notification_outbox SET delivered_at = NOW(), claimed_at = NULL, last_error = NULL WHERE id = $1",
          [row.id]
        );
      } catch (error) {
        const retry = getNotificationRetry(row.attempts);
        await database.query(
          "UPDATE notification_outbox SET attempts = $2, claimed_at = NULL, " +
          "available_at = NOW() + ($3 * INTERVAL '1 second'), " +
          "dead_at = CASE WHEN $4 THEN NOW() ELSE NULL END, last_error = $5 WHERE id = $1",
          [row.id, retry.attempts, retry.delaySeconds, retry.terminal,
            error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000)]
        );
        logger.error({ err: error, notificationId: row.id, attempts: retry.attempts, terminal: retry.terminal }, "Queued notification delivery failed");
      }
    }
  } catch (error) {
    logger.error({ err: error }, "Notification outbox processing failed");
  } finally {
    processing = false;
  }
}

export function startNotificationOutboxWorker(logger: FastifyBaseLogger): () => void {
  const timer = setInterval(() => {
    void processNotificationOutbox(logger);
  }, 5_000);
  timer.unref();
  void processNotificationOutbox(logger);
  return () => clearInterval(timer);
}
