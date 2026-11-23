import { expect, test } from "bun:test";
import { docKey } from "../../src/shared/keys";

test("docKey hashes the title and ordered sentences as a JSON array", async () => {
  const key = await docKey("Title", ["First.", "Second."]);
  expect(key).toBe(await docKey("Title", ["First.", "Second."]));
  expect(key).toMatch(/^[0-9a-f]{64}$/);
  expect(key).not.toBe(await docKey("Another title", ["First.", "Second."]));
  expect(key).not.toBe(await docKey("Title", ["First.", "Changed."]));
  expect(key).not.toBe(await docKey("Title", ["Second.", "First."]));
});
