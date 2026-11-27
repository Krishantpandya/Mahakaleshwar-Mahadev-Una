import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { database } from "../database.js";

const uuidSchema = z.string().uuid();
const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0)
});
const createCommentSchema = z.object({
  visitorId: uuidSchema,
  predefinedCommentId: uuidSchema.optional(),
  body: z.string().trim().min(1).max(2000).optional()
}).refine(
  (value) => Boolean(value.predefinedCommentId) !== Boolean(value.body),
  { message: "Provide exactly one of predefinedCommentId or body" }
);

export const commentRoutes: FastifyPluginAsync = async (app) => {
  app.get("/comments/predefined", async (_request, reply) => {
    if (!database) return reply.code(503).send({ error: "Database is not configured" });

    const result = await database.query(
      "SELECT id, body FROM predefined_comments WHERE is_active = TRUE ORDER BY sort_order ASC, body ASC"
    );
    return { data: result.rows };
  });

  app.get<{ Params: { photoId: string } }>("/photos/:photoId/comments", async (request, reply) => {
    if (!database) return reply.code(503).send({ error: "Database is not configured" });

    const photoId = uuidSchema.safeParse(request.params.photoId);
    const query = listQuerySchema.safeParse(request.query);
    if (!photoId.success || !query.success) {
      return reply.code(400).send({ error: "A valid photoId and pagination parameters are required" });
    }

    const photo = await database.query(
      "SELECT id FROM photos WHERE id = $1 AND published_at IS NOT NULL",
      [photoId.data]
    );
    if (photo.rowCount === 0) return reply.code(404).send({ error: "Photo not found" });

    const { limit, offset } = query.data;
    const result = await database.query(
      "SELECT id, body, predefined_comment_id AS \"predefinedCommentId\", created_at AS \"createdAt\" " +
      "FROM photo_comments WHERE photo_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3",
      [photoId.data, limit, offset]
    );
    return { data: result.rows, pagination: { limit, offset, returned: result.rowCount ?? 0 } };
  });

  app.post<{ Params: { photoId: string } }>("/photos/:photoId/comments", async (request, reply) => {
    if (!database) return reply.code(503).send({ error: "Database is not configured" });

    const photoId = uuidSchema.safeParse(request.params.photoId);
    const body = createCommentSchema.safeParse(request.body);
    if (!photoId.success || !body.success) {
      return reply.code(400).send({
        error: "Invalid comment payload",
        details: body.success ? undefined : body.error.flatten()
      });
    }

    const values = body.data;
    const result = values.predefinedCommentId
      ? await database.query(
          "INSERT INTO photo_comments (photo_id, visitor_id, body, predefined_comment_id) " +
          "SELECT p.id, $2, c.body, c.id FROM photos p CROSS JOIN predefined_comments c " +
          "WHERE p.id = $1 AND p.published_at IS NOT NULL AND c.id = $3 AND c.is_active = TRUE " +
          "RETURNING id, body, predefined_comment_id AS \"predefinedCommentId\", created_at AS \"createdAt\"",
          [photoId.data, values.visitorId, values.predefinedCommentId]
        )
      : await database.query(
          "INSERT INTO photo_comments (photo_id, visitor_id, body) " +
          "SELECT id, $2, $3 FROM photos WHERE id = $1 AND published_at IS NOT NULL " +
          "RETURNING id, body, predefined_comment_id AS \"predefinedCommentId\", created_at AS \"createdAt\"",
          [photoId.data, values.visitorId, values.body]
        );

    if (result.rowCount === 0) {
      const photo = await database.query(
        "SELECT id FROM photos WHERE id = $1 AND published_at IS NOT NULL",
        [photoId.data]
      );
      if (photo.rowCount === 0) return reply.code(404).send({ error: "Photo not found" });
      return reply.code(400).send({ error: "Predefined comment not found or inactive" });
    }

    return reply.code(201).send({ data: result.rows[0] });
  });
};
