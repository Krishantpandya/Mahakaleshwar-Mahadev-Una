import "dotenv/config";
import { z } from "zod";

const optionalText = z.preprocess((value) => value === "" ? undefined : value, z.string().min(1).optional());
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  CORS_ORIGINS: z.string().default("http://localhost:3000,http://localhost:5173"),
  DATABASE_URL: z.preprocess((value) => value === "" ? undefined : value, z.string().url().optional()),
  ADMIN_SESSION_COOKIE: z.string().min(1).default("mankaleshwar_admin_session"),
  ADMIN_SESSION_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  ADMIN_EMAIL: z.preprocess((value) => value === "" ? undefined : value, z.string().email().optional()),
  ADMIN_PASSWORD: z.preprocess((value) => value === "" ? undefined : value, z.string().min(12).optional()),
  B2_ENDPOINT: z.preprocess((value) => value === "" ? undefined : value, z.string().url().optional()),
  B2_REGION: optionalText,
  B2_BUCKET: optionalText,
  B2_KEY_ID: optionalText,
  B2_APPLICATION_KEY: optionalText,
  B2_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  MAX_MEDIA_UPLOAD_BYTES: z.coerce.number().int().min(1_000_000).max(100_000_000).default(25_000_000)
}).superRefine((value, context) => {
  if (value.NODE_ENV === "production" && !value.DATABASE_URL) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["DATABASE_URL"], message: "DATABASE_URL is required in production" });
  }
  const b2 = [value.B2_ENDPOINT, value.B2_REGION, value.B2_BUCKET, value.B2_KEY_ID, value.B2_APPLICATION_KEY];
  const count = b2.filter(Boolean).length;
  if (count !== 0 && count !== b2.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["B2_ENDPOINT"], message: "Configure all five B2 settings together" });
  }
  if (value.B2_ENDPOINT && new URL(value.B2_ENDPOINT).protocol !== "https:") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["B2_ENDPOINT"], message: "B2_ENDPOINT must use HTTPS" });
  }
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}
export const env = {
  nodeEnv: parsed.data.NODE_ENV, host: parsed.data.HOST, port: parsed.data.PORT,
  databaseUrl: parsed.data.DATABASE_URL,
  corsOrigins: parsed.data.CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean),
  adminSessionCookie: parsed.data.ADMIN_SESSION_COOKIE, adminSessionDays: parsed.data.ADMIN_SESSION_DAYS,
  adminEmail: parsed.data.ADMIN_EMAIL?.trim().toLowerCase(), adminPassword: parsed.data.ADMIN_PASSWORD,
  b2Endpoint: parsed.data.B2_ENDPOINT, b2Region: parsed.data.B2_REGION, b2Bucket: parsed.data.B2_BUCKET,
  b2KeyId: parsed.data.B2_KEY_ID, b2ApplicationKey: parsed.data.B2_APPLICATION_KEY,
  b2SignedUrlTtlSeconds: parsed.data.B2_SIGNED_URL_TTL_SECONDS,
  maxMediaUploadBytes: parsed.data.MAX_MEDIA_UPLOAD_BYTES
};
