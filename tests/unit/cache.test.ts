import { expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cacheKeyFor, cachePath } from "../../bridge/cache";
import { versionsFor } from "../../bridge/config";
import type { PiSpawn } from "../../bridge/selector";
import { startBridge } from "../../bridge/server";

const doc = { title: "Title", sentences: ["One.", "Two.", "Three.", "Four.", "Five.", "Six."] };
const rules = new TextEncoder().encode("Rules");
const prompt = "Prompt";

test("the cache key changes with the rules bytes, the prompt, and the fade threshold", async () => {
  const versions = await Promise.all([
    versionsFor(prompt, rules),
    versionsFor(prompt, new TextEncoder().encode("Rules\n")),
    versionsFor(prompt + "\n", rules),
    versionsFor(prompt, rules, 4),
  ]);
  const keys = await Promise.all(versions.map((version) => cacheKeyFor(doc, version)));
  expect(new Set(keys).size).toBe(4);
});

test("checked selections have their own cache keys and SKIP is cached", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "filler-cache-"));
  const versions = await versionsFor(prompt, rules);
  const check = { url: "https://example.com/repo" };
  const checked = { ...doc, check };
  const keys = await Promise.all([doc, checked, { ...doc, check: { url: "https://example.com/article" } }]
    .map((request) => cacheKeyFor(request, versions)));
  expect(new Set(keys).size).toBe(3);
  let spawns = 0;
  const spawn: PiSpawn = (command) => {
    spawns++;
    const answer = command.at(-1)?.includes(check.url) ? "SKIP" : "[1,2,3]";
    return { stdout: new Blob([answer]).stream(), exited: Promise.resolve(0), kill: () => {} };
  };
  const server = await startBridge({ port: 0, dataDir, versions, prompt, rules: "Rules" }, spawn);
  try {
    const post = async (request: typeof doc | typeof checked) => {
      const response = await fetch(new URL("/select", server.url), { method: "POST", body: JSON.stringify(request) });
      expect(response.status).toBe(200);
      return response.json();
    };
    expect(await post(checked)).toEqual({ cacheKey: keys[1], selection: { kind: "skip" } });
    expect(await post(doc)).toEqual({ cacheKey: keys[0], selection: { kind: "keep", keep: [1, 2, 3] } });
    expect(await post(checked)).toEqual({ cacheKey: keys[1], selection: { kind: "skip" } });
    expect(spawns).toBe(2);
  } finally {
    await server.stop(true);
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("overlapping requests share a Pi call and ignore incomplete cache files", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "filler-cache-"));
  const versions = await versionsFor(prompt, rules);
  let spawns = 0;
  const started = Promise.withResolvers<void>();
  const exit = Promise.withResolvers<number>();
  const spawn: PiSpawn = () => {
    spawns++;
    started.resolve();
    return { stdout: new Blob(["[1,2,3]"]).stream(), exited: exit.promise, kill: () => {} };
  };
  const server = await startBridge({ port: 0, dataDir, versions, prompt, rules: "Rules" }, spawn);

  try {
    const key = await cacheKeyFor(doc, versions);
    const cacheFile = cachePath(dataDir, key);
    const incomplete = cacheFile + ".interrupted.tmp";
    await writeFile(incomplete, "{");
    const post = () => fetch(new URL("/select", server.url), { method: "POST", body: JSON.stringify(doc) });
    const first = post();
    await started.promise;
    const second = post();
    // Give the second HTTP request time to reach the in-flight Pi call.
    await Bun.sleep(30);
    exit.resolve(0);

    for (const response of [await first, await second, await post()]) {
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ cacheKey: key, selection: { kind: "keep", keep: [1, 2, 3] } });
    }
    expect(spawns).toBe(1);
    expect(JSON.parse(await readFile(cacheFile, "utf8"))).toMatchObject({
      ...doc, ...versions, cacheKey: key, raw: "[1,2,3]", ms: expect.any(Number),
    });
    expect((await readdir(join(dataDir, "cache"))).sort()).toEqual([
      `${key}.json`, `${key}.json.interrupted.tmp`,
    ]);
    const log = (await readFile(join(dataDir, "requests.jsonl"), "utf8")).trim().split("\n")
      .map((line) => JSON.parse(line));
    expect(log.map((line) => line.source).sort()).toEqual(["cache", "pi", "shared"]);
    expect(log.reduce((count, line) => count + line.piCalls, 0)).toBe(1);
  } finally {
    exit.resolve(0);
    await server.stop(true);
    await rm(dataDir, { recursive: true, force: true });
  }
});
