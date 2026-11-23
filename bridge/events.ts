import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import type { LogEvent } from "../src/shared/types";

export function createEventLog(dataDir: string) {
  const path = join(dataDir, "events.jsonl");
  let pending = Promise.resolve();

  return function appendEvents(events: readonly LogEvent[]): Promise<void> {
    if (events.length === 0) return Promise.resolve();
    const lines = events.map((event) => JSON.stringify(event) + "\n").join("");
    // Keep batches together if concurrent requests append to the same file.
    const write = pending.then(() => appendFile(path, lines, { mode: 0o600 }));
    pending = write.catch(() => {});
    return write;
  };
}
