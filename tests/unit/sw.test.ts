import { expect, test } from "bun:test";
import { bridgeSelector } from "../../src/background/selectors";
import { bridgeAddress, issue } from "../../src/shared/connection";
import { selectDoc } from "../../src/background/sw";

test("a failed bridge fetch becomes a picks error", async () => {
  const offline = () => Promise.reject(new Error("Offline"));
  const doc = { title: "", sentences: ["a", "b", "c", "d", "e", "f"] };
  expect(await selectDoc(doc, bridgeSelector("http://127.0.0.1:18941", offline))).toEqual({ error: issue.offline });
});

test("bridge requests stay on the chosen origin and remote addresses require HTTPS", async () => {
  expect(bridgeAddress("http://127.0.0.1:18941")).toBe("http://127.0.0.1:18941");
  expect(bridgeAddress("https://bridge.example:18941/")).toBe("https://bridge.example:18941");
  expect(bridgeAddress("http://bridge.example:18941")).toBeUndefined();
  const select = bridgeSelector("https://bridge.example:18941", async (url, init) => {
    expect(url.href).toBe("https://bridge.example:18941/select");
    expect(init.redirect).toBe("error");
    return new Response(null, { status: 307, headers: { location: "https://example.com/select" } });
  });
  const doc = { title: "", sentences: ["a", "b", "c", "d", "e", "f"] };
  expect(await selectDoc(doc, select)).toEqual({ error: issue.failed });
});
