import { expect, test } from "bun:test";
import { selectDoc } from "../../src/background/sw";

test("a failed bridge fetch becomes a picks error", async () => {
  const offline = () => Promise.reject(new Error("Offline"));
  const doc = { title: "", sentences: ["a", "b", "c", "d", "e", "f"] };
  expect(await selectDoc(doc, offline)).toEqual({ error: "Offline" });
});
