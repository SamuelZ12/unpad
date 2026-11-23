import { readFile, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { cacheKeyFor, cachePath } from "./cache";
import { parseErrorResponse, parseHealthResponse, parseSelectRequest, parseSelectResponse } from "../src/shared/wire";

const { values } = parseArgs({
  options: {
    runs: { type: "string", default: "3" },
    warm: { type: "boolean", default: false },
  },
});
const runs = Number(values.runs);
if (!Number.isSafeInteger(runs) || runs < 1) throw new Error("--runs must be a positive integer");

const testData = process.env.FILLER_CUT_DATA;
if (!testData) throw new Error("Set FILLER_CUT_DATA to the test bridge's directory under /tmp");
const dataDir = await realpath(testData);
if (!dataDir.startsWith(await realpath("/tmp") + "/")) {
  throw new Error("Use a test bridge with its own directory under /tmp");
}

const url = new URL(`http://127.0.0.1:${process.env.PORT ?? 18941}`);
const health = await fetch(new URL("/health", url));
const versions = parseHealthResponse(await health.json());
if (!health.ok || !versions) throw new Error("Invalid /health response");
const logPath = join(dataDir, "requests.jsonl");
const logBefore = await readFile(logPath, "utf8");
const fixtures = [["perfloop", 0], ["wang", 3], ["warp", 8]] as const;

function printStats(label: string, passed: number, ms: number[], faded?: readonly number[]) {
  const sorted = ms.toSorted((a, b) => a - b);
  const median = (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2;
  console.log(
    `${label} ${passed}/${ms.length} passed, median ${median.toFixed(2)} ms, ` +
    `range ${sorted[0].toFixed(2)}–${sorted.at(-1)!.toFixed(2)} ms` +
    (faded ? `, faded [${faded.join(", ")}]` : ""),
  );
}

let totalPassed = 0;
const totalMs: number[] = [];
for (const [name, minFaded] of fixtures) {
  const fixture = new URL(`../tests/fixtures/sentences/${name}.json`, import.meta.url);
  const doc = parseSelectRequest(await Bun.file(fixture).json());
  if (!doc) throw new Error(`Invalid fixture ${name}`);
  const key = await cacheKeyFor(doc, versions);
  const ms: number[] = [];
  const fadedCounts: number[] = [];
  let passed = 0;
  for (let run = 1; run <= runs; run++) {
    if (!values.warm) await rm(cachePath(dataDir, key), { force: true });
    const start = performance.now();
    const response = await fetch(new URL("/select", url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(doc),
    });
    const payload: unknown = await response.json();
    ms.push(performance.now() - start);
    const result = parseSelectResponse(payload);
    if (!response.ok || result?.cacheKey !== key) {
      console.error(`${name} run ${run} HTTP ${response.status}: ${parseErrorResponse(payload)?.error ?? "invalid response"}`);
      continue;
    }

    const { selection } = result;
    const faded = selection.kind === "keep" ? doc.sentences.length - selection.keep.length : 0;
    fadedCounts.push(faded);
    if (minFaded === 0 ? selection.kind === "keep-all" : faded >= minFaded) passed++;
  }
  printStats(name, passed, ms, fadedCounts);
  totalPassed += passed;
  totalMs.push(...ms);
}

const requests = (await readFile(logPath, "utf8")).slice(logBefore.length).trim().split("\n")
  .filter(Boolean).map((line) => JSON.parse(line)).filter((line) => line.path === "/select");
const hits = requests.filter((line) => line.source === "cache").length;
const piCalls = requests.reduce((sum, line) => sum + line.piCalls, 0);
printStats(values.warm ? "Warm" : "Cold", totalPassed, totalMs);
console.log(`Request log: ${hits}/${requests.length} cache hits, ${piCalls} Pi calls`);
const logPass = requests.length === totalMs.length
  && (values.warm ? hits === totalMs.length && piCalls === 0 : hits === 0 && piCalls >= totalMs.length);
if (!logPass || totalPassed !== totalMs.length) process.exitCode = 1;
