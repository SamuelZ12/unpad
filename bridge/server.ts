import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { CacheKey, Selection } from "../src/shared/types";
import { parseSelectRequest } from "../src/shared/wire";
import type { SelectRequest } from "../src/shared/wire";
import { cacheKeyFor, readCache, writeCache } from "./cache";
import { loadConfig } from "./config";
import type { BridgeConfig } from "./config";
import { runPi, select } from "./selector";
import type { PiSpawn } from "./selector";

interface RequestLog {
  time: string;
  method: string;
  path: string;
  cacheKey: CacheKey | null;
  source: "none" | "cache" | "pi" | "shared";
  piCalls: number;
  result?: string;
  error?: string;
}

export async function startBridge(config: BridgeConfig, spawn?: PiSpawn) {
  await mkdir(join(config.dataDir, "cache"), { recursive: true, mode: 0o700 });
  const logPath = join(config.dataDir, "requests.jsonl");
  const inFlight = new Map<CacheKey, Promise<Selection>>();

  async function pick(doc: SelectRequest, cacheKey: CacheKey, log: RequestLog): Promise<Selection> {
    const pending = inFlight.get(cacheKey);
    if (pending) {
      log.source = "shared";
      return pending;
    }

    async function loadOrSelect() {
      const cached = await readCache(config.dataDir, cacheKey);
      if (cached) {
        log.source = "cache";
        return cached;
      }

      log.source = "pi";
      const start = performance.now();
      const result = await select(doc, config.prompt, config.rules, (prompt) => {
        log.piCalls++;
        return runPi(prompt, config.dataDir, spawn);
      });
      await writeCache(config.dataDir, {
        ...doc, ...config.versions, cacheKey, ...result, ms: performance.now() - start,
      });
      return result.selection;
    }

    const work = loadOrSelect();
    inFlight.set(cacheKey, work);
    try {
      return await work;
    } finally {
      inFlight.delete(cacheKey);
    }
  }

  return Bun.serve({
    hostname: "127.0.0.1",
    port: config.port,
    idleTimeout: 60,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      const start = performance.now();
      const log: RequestLog = {
        time: new Date().toISOString(), method: request.method, path,
        cacheKey: null, source: "none", piCalls: 0,
      };
      function fail(status: number, error: string) {
        log.error = error;
        return Response.json({ error }, { status });
      }

      try {
        if (request.method === "GET" && path === "/health") {
          log.result = "healthy";
          return Response.json(config.versions);
        }

        if (request.method === "POST" && path === "/select") {
          const doc = parseSelectRequest(await request.json().catch(() => undefined));
          if (!doc) return fail(400, "Invalid select request");
          const cacheKey = await cacheKeyFor(doc, config.versions);
          log.cacheKey = cacheKey;
          try {
            const selection = await pick(doc, cacheKey, log);
            log.result = selection.kind;
            return Response.json({ cacheKey, selection });
          } catch (error) {
            return fail(502, error instanceof Error ? error.message : "Selection failed");
          }
        }

        return fail(404, "Not found");
      } finally {
        await appendFile(logPath, JSON.stringify({ ...log, ms: performance.now() - start }) + "\n", {
          mode: 0o600,
        });
      }
    },
  });
}

if (import.meta.main) {
  const server = await startBridge(await loadConfig());
  console.log(`Filler Cut bridge listening on ${server.url}`);
}
