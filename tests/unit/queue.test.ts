import { expect, test } from "bun:test";
import { enqueueEvents } from "../../src/background/events";
import type { LogEvent } from "../../src/shared/types";

test("failed deliveries stay queued and the next delivery flushes them in order", async () => {
  let pending: readonly LogEvent[] = [];
  const attempts: string[][] = [];
  const send = enqueueEvents({
    async load() { return pending; },
    async save(events) { pending = events; },
    async post(events) {
      attempts.push(events.map((event) => event.id));
      return attempts.length > 1;
    },
  });
  const first = { type: "reveal", id: "first", pageView: "a", url: "https://x.com/", at: "", heldMs: 250 } as const;
  await send([first]);
  expect(pending).toEqual([first]);
  await Promise.all([send([{ ...first, id: "second" }]), send([{ ...first, id: "third" }])]);
  expect(attempts).toEqual([["first"], ["first", "second"], ["third"]]);
  expect(pending).toEqual([]);
});
