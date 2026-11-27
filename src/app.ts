import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import { env } from "./config/env.js";
import { database } from "./database.js";
import { healthRoutes } from "./routes/health.routes.js";
import { photoRoutes } from "./routes/photos.routes.js";
import { commentRoutes } from "./routes/comments.routes.js";
import { announcementRoutes } from "./routes/announcements.routes.js";
import { pushSubscriptionRoutes } from "./routes/push-subscriptions.routes.js";
import { adminAuthRoutes } from "./routes/admin-auth.routes.js";
import { adminContentRoutes } from "./routes/admin-content.routes.js";
import { startNotificationOutboxWorker } from "./notifications/outbox.js";

export function buildApp() {
  let stopNotificationWorker: (() => void) | undefined;
  const app = Fastify({
    logger: {
      level: env.nodeEnv === "production" ? "info" : "debug",
      redact: { paths: ["req.headers.authorization", "req.headers.cookie", "res.headers.set-cookie"], censor: "[REDACTED]" }
    },
    trustProxy: false
  });
  app.register(helmet);
  app.register(cookie);
  app.register(cors, { origin: env.corsOrigins, credentials: true });
  app.register(rateLimit, { max: 100, timeWindow: "1 minute" });
  app.register(multipart, { limits: { fileSize: env.maxMediaUploadBytes, files: 1 } });
  app.register(healthRoutes, { prefix: "/api/v1" });
  app.register(photoRoutes, { prefix: "/api/v1" });
  app.register(commentRoutes, { prefix: "/api/v1" });
  app.register(announcementRoutes, { prefix: "/api/v1" });
  app.register(pushSubscriptionRoutes, { prefix: "/api/v1" });
  app.register(adminAuthRoutes, { prefix: "/api/v1/admin/auth" });
  app.register(adminContentRoutes, { prefix: "/api/v1" });
  app.addHook("onReady", async () => {
    stopNotificationWorker = startNotificationOutboxWorker(app.log);
  });
  app.addHook("onClose", async () => {
    stopNotificationWorker?.();
    await database?.end();
  });
  app.setErrorHandler((error, request, reply) => {
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    const errorStatus = (normalizedError as Error & { statusCode?: number }).statusCode;
    request.log.error({ err: normalizedError }, "Request failed");
    const statusCode = errorStatus && errorStatus >= 400 && errorStatus < 500 ? errorStatus : 500;
    return reply.status(statusCode).send({
      error: statusCode === 500 ? "Internal Server Error" : normalizedError.name,
      message: statusCode === 500 ? "An unexpected error occurred." : normalizedError.message
    });
  });
  return app;
}
