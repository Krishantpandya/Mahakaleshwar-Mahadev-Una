import type { FastifyInstance } from "fastify";
import { database } from "../database.js";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/ready", async (_request, reply) => {
    if (!database) return reply.code(503).send({ status: "not_ready", database: "unconfigured" });
    try {
      await database.query("SELECT 1");
      return { status: "ready", database: "connected" };
    } catch (error) {
      app.log.error({ err: error }, "Readiness database check failed");
      return reply.code(503).send({ status: "not_ready", database: "unavailable" });
    }
  });

  app.get("/health", {
    schema: {
      response: {
        200: {
          type: "object",
          required: ["status", "service", "timestamp"],
          properties: {
            status: { type: "string", enum: ["ok"] },
            service: { type: "string" },
            timestamp: { type: "string", format: "date-time" }
          }
        }
      }
    }
  }, async () => ({
    status: "ok" as const,
    service: "mankaleshwar-mahadev-api",
    timestamp: new Date().toISOString()
  }));
}
