import { mkdir, mkdtemp, rm, cp, readdir } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "../../../bridge/config";
import { startBridge } from "../../../bridge/server";
import type { LogEvent } from "../../../src/shared/types";
import { poll } from "./pixels";

export const bridgeUrl = "http://127.0.0.1:18941";

interface RequestLog {
  time: string;
  ms: number;
  path: string;
  cacheKey: string | null;
  source: string;
  piCalls: number;
  result?: string;
  error?: string;
}

export async function testBridge() {
  const data = await mkdtemp("/tmp/filler-bridge-");
  const config = await loadConfig();
  let server: Awaited<ReturnType<typeof startBridge>> | undefined;
  async function start(invalid = false) {
    if (server) throw new Error("Test bridge already started");
    server = await startBridge({ ...config, port: 18941, dataDir: data }, invalid ? () => ({
      stdout: new Blob(["invalid selection"]).stream(),
      exited: Promise.resolve(0),
      kill() {},
    }) : undefined);
  }
  async function stop() {
    await server?.stop(true);
    server = undefined;
  }
  async function lines<T>(name: string): Promise<T[]> {
    const file = Bun.file(join(data, name));
    if (!(await file.exists())) return [];
    return (await file.text()).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  }
  return {
    start, stop, data,
    clear: async () => {
      const cache = join(data, "cache");
      await mkdir(cache, { recursive: true });
      for (const name of await readdir(cache)) await rm(join(cache, name));
    },
    requests: async () => (await lines<RequestLog>("requests.jsonl")).filter((row) => row.path === "/select"),
    events: () => lines<LogEvent>("events.jsonl"),
    async waitForRequest(index: number) {
      return (await poll(() => lines<RequestLog>("requests.jsonl").then((rows) => rows.filter((r) => r.path === "/select")), (rows) => rows.length > index, 45_000))[index];
    },
    async close(evidence: string) {
      await stop();
      try { await cp(data, join(evidence, "bridge"), { recursive: true }); }
      finally { await rm(data, { recursive: true, force: true }); }
    },
  };
}
