import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Mode } from "./lib/browser";
import { bridgeUrl, testBridge } from "./lib/bridge";
import load from "./load";
import extract from "./extract";

import S1 from "./S1";
import S2 from "./S2";
import S3 from "./S3";
import S4 from "./S4";
import S5 from "./S5";
import S6 from "./S6";
import S7 from "./S7";
import S14 from "./S14";
import S16 from "./S16";

import picks from "./picks";
import dark from "./dark";

const checks = { load, extract, picks, S3, S1, S4, S2, S6, S16, S5, dark, S7, S14 };
const args = Bun.argv.slice(2);
const modeFlag = args.find((arg) => arg.startsWith("--mode="));
const mode = (modeFlag?.slice(7) ?? "logged-out") as Mode;
const ids = args.filter((arg) => arg !== modeFlag);
if (!ids.length || !["logged-out", "replay", "logged-in"].includes(mode) ||
  ids.some((id) => id !== "all" && !Object.hasOwn(checks, id))) {
  throw new Error("Usage: bun run verify [--mode=logged-out|replay|logged-in] <check ...|all>");
}

const evidence = join(homedir(), ".pi/agent/filler-cut/evidence", new Date().toISOString().replaceAll(":", "-"));
await mkdir(evidence, { recursive: true });
console.log(`Evidence: ${evidence}`);
const build = Bun.spawn([process.execPath, "run", "build"], {
  env: { ...process.env, BRIDGE_URL: bridgeUrl, FILLER_CUT_DEV: "1" },
  stdout: "inherit", stderr: "inherit",
});
if (await build.exited !== 0) throw new Error("Extension build failed");

const bridge = await testBridge();
const reports: string[] = [];
try {
  for (const id of ids.includes("all") ? Object.keys(checks) : ids) {
    const directory = join(evidence, id);
    await mkdir(directory);
    const check = checks[id as keyof typeof checks];
    let message: string;
    try {
      message = `PASS ${id} [${mode}] ${await check({ evidence: directory, mode, bridge } as CheckContext)}`;
    } catch (error) {
      process.exitCode = 1;
      message = `FAIL ${id} [${mode}] ${error}`;
    }
    await bridge.archive();
    await bridge.warmCache();
    reports.push(message);
    console.log(message);
    await Bun.write(join(evidence, "results.log"), reports.join("\n") + "\n");
  }
} finally {
  await bridge.close(evidence);
}

export interface CheckContext {
  evidence: string;
  mode: Mode;
  bridge: Awaited<ReturnType<typeof testBridge>>;
}
