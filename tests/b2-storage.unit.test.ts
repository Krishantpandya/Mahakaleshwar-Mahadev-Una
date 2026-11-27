import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createB2ReadUrl,
  deleteB2Object,
  isB2Configured,
  StorageNotConfiguredError,
  uploadB2Object
} from "../src/storage/b2.js";

test("B2 operations fail closed when private storage credentials are absent", async () => {
  assert.equal(isB2Configured(), false);
  const error = { name: "StorageNotConfiguredError" };
  await assert.rejects(uploadB2Object({
    key: "photos/test.jpg", body: Buffer.from("test"), contentType: "image/jpeg"
  }), (actual: unknown) => actual instanceof StorageNotConfiguredError && actual.name === error.name);
  await assert.rejects(deleteB2Object("photos/test.jpg"), StorageNotConfiguredError);
  await assert.rejects(createB2ReadUrl("photos/test.jpg"), StorageNotConfiguredError);
});
