import assert from "node:assert/strict";
import { test } from "node:test";
import { S3Client } from "@aws-sdk/client-s3";
import {
  createB2ReadUrl,
  createB2Storage,
  deleteB2Object,
  isB2Configured,
  StorageNotConfiguredError,
  uploadB2Object
} from "../src/storage/b2.js";

test("B2 operations fail closed when private storage credentials are absent", async () => {
  assert.equal(isB2Configured(), false);
  await assert.rejects(uploadB2Object({
    key: "photos/test.jpg", body: Buffer.from("test"), contentType: "image/jpeg"
  }), StorageNotConfiguredError);
  await assert.rejects(deleteB2Object("photos/test.jpg"), StorageNotConfiguredError);
  await assert.rejects(createB2ReadUrl("photos/test.jpg"), StorageNotConfiguredError);
});

test("B2 adapter sends private-bucket upload/delete commands and creates expiring read URLs", async () => {
  const client = new S3Client({
    endpoint: "https://s3.us-west-004.backblazeb2.com",
    region: "us-west-004",
    forcePathStyle: true,
    credentials: { accessKeyId: "test-key-id", secretAccessKey: "test-application-key" }
  });
  const commands: unknown[] = [];
  (client as unknown as { send: (command: unknown) => Promise<unknown> }).send = async (command) => {
    commands.push(command);
    return {};
  };

  try {
    const storage = createB2Storage(client, "private-temple-media", 900);
    const body = Buffer.from("test image bytes");
    await storage.upload({ key: "photos/test.jpg", body, contentType: "image/jpeg" });
    await storage.delete("photos/test.jpg");
    const readUrl = await storage.createReadUrl("photos/test.jpg");

    assert.equal(commands.length, 2);
    const put = commands[0] as { constructor: { name: string }; input: Record<string, unknown> };
    const remove = commands[1] as { constructor: { name: string }; input: Record<string, unknown> };
    assert.equal(put.constructor.name, "PutObjectCommand");
    assert.equal(put.input.Bucket, "private-temple-media");
    assert.equal(put.input.Key, "photos/test.jpg");
    assert.equal(put.input.ContentType, "image/jpeg");
    assert.equal(put.input.ContentLength, body.length);
    assert.equal(remove.constructor.name, "DeleteObjectCommand");
    assert.equal(remove.input.Bucket, "private-temple-media");
    assert.equal(remove.input.Key, "photos/test.jpg");
    assert.match(readUrl, /^https:\/\/s3\.us-west-004\.backblazeb2\.com\//);
    assert.match(readUrl, /X-Amz-Expires=900/);
  } finally {
    client.destroy();
  }
});

test("B2 adapter rejects invalid signed URL expiry settings", () => {
  const client = new S3Client({ region: "us-west-004" });
  try {
    assert.throws(() => createB2Storage(client, "private-temple-media", 30), /between 60 and 3600/);
    assert.throws(() => createB2Storage(client, " ", 900), /bucket name is required/);
  } finally {
    client.destroy();
  }
});
