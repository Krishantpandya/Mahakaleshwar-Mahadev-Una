import webPush from "web-push";
import type { FastifyBaseLogger } from "fastify";
import { database } from "../database.js";
import { env } from "../config/env.js";

export type NotificationChannel = "photos" | "announcements";

let vapidConfigured = false;
if (env.vapidPublicKey && env.vapidPrivateKey && env.vapidSubject) {
  webPush.setVapidDetails(env.vapidSubject, env.vapidPublicKey, env.vapidPrivateKey);
  vapidConfigured = true;
}

export function isPushConfigured(): boolean {
  return vapidConfigured;
}

export async function notifyChannel(
  channel: NotificationChannel,
  payload: { title: string; body: string; url: string },
  logger: FastifyBaseLogger
): Promise<void> {
  if (!database || !vapidConfigured) {
    logger.warn({ channel }, "Push notification skipped: database or VAPID configuration is unavailable");
    return;
  }

  const result = await database.query(
    "SELECT s.id, s.endpoint, s.p256dh_key, s.auth_key " +
    "FROM push_subscriptions s JOIN push_subscription_channels c ON c.push_subscription_id = s.id " +
    "WHERE c.channel = $1",
    [channel]
  );

  const subscriptions = result.rows as Array<{
    id: string; endpoint: string; p256dh_key: string; auth_key: string;
  }>;
  let sent = 0;
  let failed = 0;

  for (let start = 0; start < subscriptions.length; start += 20) {
    const batch = subscriptions.slice(start, start + 20);
    await Promise.all(batch.map(async (subscription) => {
      const target = {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh_key, auth: subscription.auth_key }
      };
      let delivered = false;

      for (let attempt = 0; attempt < 3 && !delivered; attempt += 1) {
        try {
          await webPush.sendNotification(target, JSON.stringify(payload), { TTL: 60 });
          delivered = true;
          sent += 1;
        } catch (error) {
          const statusCode = typeof error === "object" && error !== null && "statusCode" in error
            ? Number((error as { statusCode?: unknown }).statusCode)
            : 0;

          if (statusCode === 404 || statusCode === 410) {
            await database!.query("DELETE FROM push_subscriptions WHERE id = $1", [subscription.id]);
            failed += 1;
            return;
          }

          if ((statusCode === 429 || statusCode >= 500 || statusCode === 0) && attempt < 2) {
            await new Promise((resolve) => setTimeout(resolve, 250 * (2 ** attempt)));
            continue;
          }

          failed += 1;
          logger.error({ err: error, channel, subscriptionId: subscription.id, statusCode }, "Push delivery failed");
          return;
        }
      }
    }));
  }

  logger.info({ channel, attempted: subscriptions.length, sent, failed }, "Push notification batch completed");
}
