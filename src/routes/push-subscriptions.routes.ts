import type { FastifyPluginAsync } from "fastify";
import { isIP } from "node:net";
import { z } from "zod";
import { database } from "../database.js";

const endpointSchema = z.string().url().max(4096).refine((value) => {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password) return false;
    if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) return false;
    // Literal IP endpoints are not needed for browser push services and can target private infrastructure.
    if (isIP(hostname)) return false;
    return true;
  } catch {
    return false;
  }
}, { message: "A public HTTPS push endpoint is required" });

const subscriptionSchema = z.object({
  endpoint: endpointSchema,
  keys: z.object({
    p256dh: z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/),
    auth: z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/)
  }),
  channels: z.array(z.enum(["photos", "announcements"])).min(1).max(2)
}).refine((value) => new Set(value.channels).size === value.channels.length, {
  message: "Each notification channel may only be included once"
});

export const pushSubscriptionRoutes: FastifyPluginAsync = async (app) => {
  app.put("/push-subscriptions", {
    config: { rateLimit: { max: 10, timeWindow: "10 minutes" } }
  }, async (request, reply) => {
    if (!database) {
      return reply.code(503).send({ error: "Database is not configured" });
    }

    const parsed = subscriptionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid push subscription",
        details: parsed.error.flatten()
      });
    }

    const client = await database.connect();
    try {
      await client.query("BEGIN");
      const { endpoint, keys, channels } = parsed.data;
      const subscription = await client.query(
        "INSERT INTO push_subscriptions (endpoint, p256dh_key, auth_key) " +
        "VALUES ($1, $2, $3) " +
        "ON CONFLICT (endpoint) DO UPDATE SET " +
        "p256dh_key = EXCLUDED.p256dh_key, auth_key = EXCLUDED.auth_key, updated_at = NOW() " +
        "RETURNING id",
        [endpoint, keys.p256dh, keys.auth]
      );

      const subscriptionId = subscription.rows[0].id as string;
      await client.query(
        "DELETE FROM push_subscription_channels WHERE push_subscription_id = $1",
        [subscriptionId]
      );

      for (const channel of channels) {
        await client.query(
          "INSERT INTO push_subscription_channels (push_subscription_id, channel) VALUES ($1, $2)",
          [subscriptionId, channel]
        );
      }

      await client.query("COMMIT");
      return reply.code(200).send({ subscribed: channels });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });
};
