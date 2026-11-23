import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEventLog } from "../../bridge/events";
import { parseEventsRequest } from "../../src/shared/wire";

const common = { at: "2026-11-23T00:00:00Z", pageView: "view", url: "https://x.com/" };
const cacheKey = "a".repeat(64);
const restore = { ...common, id: "restored", type: "restore", cacheKey, sentenceId: 1 };
const events = [
  { ...common, id: "shown", type: "shown", cacheKey, total: 6, faded: 3 },
  { ...restore, text: "Text with a newline\ninside." },
  { ...common, id: "revealed", type: "reveal", heldMs: 345.5 },
];

test("event parser rejects unknown types and restores without text", () => {
  expect(parseEventsRequest({ events })).toBeDefined();
  expect(parseEventsRequest({ events: [{ ...restore, type: "unknown" }] })).toBeUndefined();
  expect(parseEventsRequest({ events: [events[0], restore] })).toBeUndefined();
});

test("event log appends one JSON line per event, keeping each delivery", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "filler-events-"));
  try {
    const parsed = parseEventsRequest({ events });
    if (!parsed) throw new Error("Invalid fixture events");
    const appendEvents = createEventLog(dataDir);
    const other = { ...parsed.events[0], id: "other" };
    await Promise.all([appendEvents(parsed.events), appendEvents([other]), appendEvents(parsed.events)]);

    const log = await readFile(join(dataDir, "events.jsonl"), "utf8");
    expect(log.endsWith("\n")).toBe(true);
    expect(log.trimEnd().split("\n").map((line) => JSON.parse(line))).toEqual([
      ...events, other, ...events,
    ]);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
