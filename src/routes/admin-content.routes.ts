import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { database } from "../database.js";
import { env } from "../config/env.js";
import { requireAdmin } from "./admin-auth.routes.js";
import { createB2ReadUrl, deleteB2Object, isB2Configured, uploadB2Object } from "../storage/b2.js";
import { isDecodableImage, type SupportedImageMime } from "../storage/image-validation.js";

const imageTypes: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/avif": "avif"
};
async function cleanupObject(app: FastifyInstance, key: string): Promise<void> {
  try { await deleteB2Object(key); }
  catch (error) { app.log.error({ err: error, key }, "Failed to clean up orphaned B2 object"); }
}

export const adminContentRoutes: FastifyPluginAsync = async (app) => {
  app.post("/admin/photos", {
    preHandler: requireAdmin,
    config: { rateLimit: { max: 20, timeWindow: "1 hour" } }
  }, async (request, reply) => {
    if (!database) return reply.code(503).send({ error: "Database is not configured" });
    if (!isB2Configured()) return reply.code(503).send({ error: "Backblaze B2 storage is not configured" });
    const query = z.object({
      caption: z.string().trim().max(500).optional(),
      takenAt: z.string().datetime({ offset: true }).optional()
    }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "Invalid photo metadata", details: query.error.flatten() });

    const file = await request.file({ limits: { files: 1, fields: 0, fileSize: env.maxMediaUploadBytes } });
    if (!file) return reply.code(400).send({ error: "An image file is required" });
    const body = await file.toBuffer();
    const extension = imageTypes[file.mimetype];
    if (!extension) return reply.code(415).send({ error: "Only JPEG, PNG, WebP, and AVIF images are accepted" });
    if (!(await isDecodableImage(body, file.mimetype as SupportedImageMime))) {
      return reply.code(415).send({ error: "Image is invalid, truncated, unsupported, or exceeds the 20-megapixel limit" });
    }

    const id = randomUUID();
    const key = `photos/${id}.${extension}`;
    await uploadB2Object({ key, body, contentType: file.mimetype });
    try {
      const mediaUrl = await createB2ReadUrl(key);
      const client = await database.connect();
      let result;
      try {
        await client.query("BEGIN");
        result = await client.query(
          "INSERT INTO photos (id, storage_key, media_url, mime_type, file_size_bytes, caption, taken_at, published_at, created_by_admin_id) " +
          "VALUES ($1, $2, NULL, $3, $4, $5, $6, NOW(), $7) " +
          "RETURNING id, mime_type, file_size_bytes, caption, taken_at, published_at, uploaded_at",
          [id, key, file.mimetype, body.length, query.data.caption ?? null, query.data.takenAt ?? null, request.admin?.id ?? null]
        );
        await client.query(
          "INSERT INTO notification_outbox (channel, payload) VALUES ($1, $2::jsonb)",
          ["photos", JSON.stringify({
            title: "New temple photo",
            body: query.data.caption || "A new photo has been published.",
            url: "/"
          })]
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      return reply.code(201).send({ data: { ...result.rows[0], media_url: mediaUrl } });
    } catch (error) {
      await cleanupObject(app, key);
      throw error;
    }
  });

  app.post("/admin/announcements", {
    preHandler: requireAdmin,
    config: { rateLimit: { max: 20, timeWindow: "1 hour" } }
  }, async (request, reply) => {
    if (!database) return reply.code(503).send({ error: "Database is not configured" });
    const fields: Record<string, string> = {};
    let image: { body: Buffer; mimetype: string; extension: string } | undefined;
    for await (const part of request.parts({ limits: { files: 1, fields: 2, fileSize: env.maxMediaUploadBytes } })) {
      if (part.type === "file") {
        const body = await part.toBuffer();
        const extension = imageTypes[part.mimetype];
        if (!extension) return reply.code(415).send({ error: "Only JPEG, PNG, WebP, and AVIF poster images are accepted" });
        if (!(await isDecodableImage(body, part.mimetype as SupportedImageMime))) {
          return reply.code(415).send({ error: "Poster image is invalid, truncated, unsupported, or exceeds the 20-megapixel limit" });
        }
        image = { body, mimetype: part.mimetype, extension };
      } else {
        if (Object.prototype.hasOwnProperty.call(fields, part.fieldname)) {
          return reply.code(400).send({ error: `Duplicate announcement field: ${part.fieldname}` });
        }
        fields[part.fieldname] = String(part.value);
      }
    }
    const parsed = z.object({
      title: z.string().trim().max(200).optional(),
      message: z.string().trim().max(5000).optional()
    }).strict().safeParse(fields);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid announcement fields", details: parsed.error.flatten() });
    const title = parsed.data.title || null;
    const message = parsed.data.message || null;
    if (!message && !image) return reply.code(400).send({ error: "An announcement requires text or a poster image" });
    if (image && !isB2Configured()) return reply.code(503).send({ error: "Backblaze B2 storage is not configured" });

    const id = randomUUID();
    const key = image ? `announcements/${id}.${image.extension}` : null;
    if (image && key) await uploadB2Object({ key, body: image.body, contentType: image.mimetype });
    try {
      const posterUrl = key ? await createB2ReadUrl(key) : null;
      const client = await database.connect();
      let result;
      try {
        await client.query("BEGIN");
        result = await client.query(
          "INSERT INTO announcements (id, title, message, poster_storage_key, poster_media_url, published_at, created_by_admin_id) " +
          "VALUES ($1, $2, $3, $4, NULL, NOW(), $5) RETURNING id, title, message, published_at",
          [id, title, message, key, request.admin?.id ?? null]
        );
        await client.query(
          "INSERT INTO notification_outbox (channel, payload) VALUES ($1, $2::jsonb)",
          ["announcements", JSON.stringify({
            title: title || "Temple announcement",
            body: message
              ? (message.length > 180 ? message.slice(0, 177).trimEnd() + "..." : message)
              : "A new announcement has been published.",
            url: "/"
          })]
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      return reply.code(201).send({ data: { ...result.rows[0], poster_media_url: posterUrl } });
    } catch (error) {
      if (key) await cleanupObject(app, key);
      throw error;
    }
  });
};
