import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../config/env.js";

const configured = Boolean(env.b2Endpoint && env.b2Region && env.b2Bucket && env.b2KeyId && env.b2ApplicationKey);
const client = configured ? new S3Client({
  endpoint: env.b2Endpoint,
  region: env.b2Region,
  forcePathStyle: true,
  credentials: { accessKeyId: env.b2KeyId!, secretAccessKey: env.b2ApplicationKey! }
}) : null;

export class StorageNotConfiguredError extends Error {
  constructor() { super("Backblaze B2 storage is not configured"); this.name = "StorageNotConfiguredError"; }
}
function requireStorage(): S3Client {
  if (!client || !env.b2Bucket) throw new StorageNotConfiguredError();
  return client;
}
export function isB2Configured(): boolean { return configured; }

export async function uploadB2Object(input: { key: string; body: Buffer; contentType: string }): Promise<void> {
  await requireStorage().send(new PutObjectCommand({
    Bucket: env.b2Bucket!, Key: input.key, Body: input.body,
    ContentType: input.contentType, ContentLength: input.body.length
  }));
}
export async function deleteB2Object(key: string): Promise<void> {
  await requireStorage().send(new DeleteObjectCommand({ Bucket: env.b2Bucket!, Key: key }));
}
export async function createB2ReadUrl(key: string): Promise<string> {
  return getSignedUrl(requireStorage(), new GetObjectCommand({ Bucket: env.b2Bucket!, Key: key }), {
    expiresIn: env.b2SignedUrlTtlSeconds
  });
}
