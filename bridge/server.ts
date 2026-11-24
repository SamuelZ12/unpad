import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { CacheKey } from "../src/shared/types";
import { parseEventsRequest, parseSelectRequest } from "../src/shared/wire";
import type { HealthResponse, SelectRequest, SelectResponse } from "../src/shared/wire";
import { cacheKeyFor, readCache, writeCache } from "./cache";
import { loadConfig } from "./config";
import type { BridgeConfig } from "./config";
import { createEventLog } from "./events";
import { runPi, select, selectWithKey } from "./selector";
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
  const appendEvents = createEventLog(config.dataDir);
  const inFlight = new Map<CacheKey, Promise<SelectResponse>>();

  async function pick(doc: SelectRequest, versions: HealthResponse, cacheKey: CacheKey, log: RequestLog): Promise<SelectResponse> {
    const pending = inFlight.get(cacheKey);
    if (pending) {
      log.source = "shared";
      return pending;
    }

    async function loadOrSelect() {
      const cached = await readCache(config.dataDir, cacheKey);
      if (cached && (!doc.key || cached.key !== undefined)) {
        log.source = "cache";
        const { selection, key } = cached;
        return doc.key ? { cacheKey, selection, key } : { cacheKey, selection };
      }

      log.source = "pi";
      const start = performance.now();
      function ask(prompt: string) {
        log.piCalls++;
        return runPi(prompt, config.dataDir, spawn);
      }
      const { raw, ...result } = doc.key
        ? await selectWithKey(doc, config.prompt, config.keyPrompt, config.rules, ask)
        : await select(doc, config.prompt, config.rules, ask);
      const picks = { cacheKey, ...result };
      const { title, sentences, check } = doc;
      await writeCache(config.dataDir, {
        title, sentences, check, ...versions, ...picks, raw, ms: performance.now() - start,
      });
      return picks;
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
          const versions = doc.key ? config.keyVersions : config.versions;
          const cacheKey = await cacheKeyFor(doc, versions);
          log.cacheKey = cacheKey;
          try {
            const picks = await pick(doc, versions, cacheKey, log);
            log.result = picks.selection.kind;
            return Response.json(picks);
          } catch (error) {
            return fail(502, error instanceof Error ? error.message : "Selection failed");
          }
        }

        if (request.method === "POST" && path === "/events") {
          const body = parseEventsRequest(await request.json().catch(() => undefined));
          if (!body) return fail(400, "Invalid events request");
          try {
            await appendEvents(body.events);
            log.result = "accepted";
            return Response.json({ accepted: body.events.length });
          } catch {
            return fail(500, "Could not append events");
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
