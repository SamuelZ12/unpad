import { expect, test } from "bun:test";
import { bridgeSelector } from "../../src/background/selectors";
import { issue } from "../../src/shared/connection";
import { selectDoc } from "../../src/background/sw";

test("a failed bridge fetch becomes a picks error", async () => {
  const offline = () => Promise.reject(new Error("Offline"));
  const doc = { title: "", sentences: ["a", "b", "c", "d", "e", "f"] };
  expect(await selectDoc(doc, bridgeSelector("http://127.0.0.1:18941", offline))).toEqual({ error: issue.offline });
});
