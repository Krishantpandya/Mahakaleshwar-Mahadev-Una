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

export function createB2Storage(client: S3Client, bucket: string, signedUrlTtlSeconds: number) {
  if (!bucket.trim()) throw new Error("A B2 bucket name is required");
  if (!Number.isInteger(signedUrlTtlSeconds) || signedUrlTtlSeconds < 60 || signedUrlTtlSeconds > 3600) {
    throw new Error("B2 signed URL TTL must be between 60 and 3600 seconds");
  }
  return {
    async upload(input: { key: string; body: Buffer; contentType: string }): Promise<void> {
      await client.send(new PutObjectCommand({
        Bucket: bucket, Key: input.key, Body: input.body,
        ContentType: input.contentType, ContentLength: input.body.length
      }));
    },
    async delete(key: string): Promise<void> {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
    async createReadUrl(key: string): Promise<string> {
      return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
        expiresIn: signedUrlTtlSeconds
      });
    }
  };
}

const storage = configured
  ? createB2Storage(client!, env.b2Bucket!, env.b2SignedUrlTtlSeconds)
  : null;

function requireStorage() {
  if (!storage) throw new StorageNotConfiguredError();
  return storage;
}
export function isB2Configured(): boolean { return configured; }

export async function uploadB2Object(input: { key: string; body: Buffer; contentType: string }): Promise<void> {
  await requireStorage().upload(input);
}
export async function deleteB2Object(key: string): Promise<void> {
  await requireStorage().delete(key);
}
export async function createB2ReadUrl(key: string): Promise<string> {
  return requireStorage().createReadUrl(key);
}
