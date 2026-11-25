import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { launch, type Mode } from "./lib/browser";
import { TOGGLE_COMMAND } from "../../src/shared/config";
import { bridgeUrl, testBridge } from "./lib/bridge";
import load from "./load";
import extract from "./extract";
import demo from "./demo";

import S1 from "./S1";
import S2 from "./S2";
import S3 from "./S3";
import S4 from "./S4";
import S5 from "./S5";
import S6 from "./S6";
import S7 from "./S7";
import S8 from "./S8";
import S9 from "./S9";
import S10 from "./S10";
import S11 from "./S11";
import S12 from "./S12";
import S12PageMode from "./S12-page-mode";
import S12AddedSite from "./S12-added-site";
import S12PageCheck from "./S12-page-check";
import S13 from "./S13";
import S15 from "./S15";
import S14 from "./S14";
import S16 from "./S16";
import S17 from "./S17";
import S18 from "./S18";

import picks from "./picks";
import S19 from "./S19";
import S20 from "./S20";
import S21 from "./S21";

const checks = { load, extract, picks, S3, S1, S4, S2, S6, S16, S5, S7, S14, S8, S9, S15, S10, S11, S12,
  "S12-page-mode": S12PageMode, "S12-added-site": S12AddedSite, "S12-page-check": S12PageCheck, S13, S17, S18, S19, S20, S21 };
const args = Bun.argv.slice(2);
const modeFlag = args.find((arg) => arg.startsWith("--mode="));
const mode = (modeFlag?.slice(7) ?? "logged-out") as Mode;
const ids = args.filter((arg) => arg !== modeFlag);
const recording = ids.length === 1 && ids[0] === "demo";
if (!ids.length || !["logged-out", "replay", "logged-in"].includes(mode) ||
  (!recording && ids.some((id) => id !== "all" && !Object.hasOwn(checks, id)))) {
  throw new Error("Usage: bun run verify [--mode=logged-out|replay|logged-in] <check ...|all|demo>");
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
const fallbackExtension = await mkdtemp("/tmp/filler-extension-fallback-");
async function runChecks() {
  const reports: string[] = [];
  let accountError: unknown;
  if (mode === "logged-in") {
    try {
      const browser = await launch(mode);
      const page = browser.context.pages()[0];
      try {
        await browser.open(page, "wang");
      } catch (error) {
        await page.screenshot({ path: join(evidence, "signed-in-preflight.png") }).catch(() => {});
        throw error;
      } finally {
        await browser.close();
      }
    } catch (error) {
      accountError = error;
    }
  }
  const all = ids.includes("all");
  const requested = all ? Object.keys(checks).filter((id) => /^S\d/.test(id)) : ids;
  for (const id of requested) {
    const directory = join(evidence, id);
    await mkdir(directory);
    const check = checks[id as keyof typeof checks];
    const freshProfile = id.startsWith("S12") || id === "S19" || id === "S21"
      || (mode === "logged-in" && ["S4", "S14", "S15", "S16", "S18"].includes(id));
    const actualMode = freshProfile ? "logged-out" : id === "S20" || (id === "S10" && mode === "logged-out") ? "replay" : mode;
    let message: string;
    try {
      if (accountError && actualMode === "logged-in") throw accountError;
      message = `PASS ${id} [${actualMode}] ${await check({ evidence: directory, mode: actualMode, bridge, fallbackExtension })}`;
    } catch (error) {
      process.exitCode = 1;
      message = `FAIL ${id} [${actualMode}] ${error}`;
    }
    await bridge.archive();
    await bridge.warmCache();
    reports.push(message);
    console.log(message);
    await Bun.write(join(evidence, "results.log"), reports.join("\n") + "\n");
  }
}

try {
  if (recording) {
    await demo({ evidence, mode, bridge, fallbackExtension });
  } else {
    // CDP sends page keys. Install the same extension with an unassigned
    // browser shortcut for checks that exercise the page-key fallback.
    await cp("dist/extension", fallbackExtension, { recursive: true });
    const path = join(fallbackExtension, "manifest.json");
    const manifest = await Bun.file(path).json();
    delete manifest.commands[TOGGLE_COMMAND].suggested_key;
    await Bun.write(path, JSON.stringify(manifest));
    await runChecks();
  }
} finally {
  await rm(fallbackExtension, { recursive: true, force: true });
  await bridge.close(evidence);
}

export interface CheckContext {
  evidence: string;
  mode: Mode;
  fallbackExtension: string;
  bridge: Awaited<ReturnType<typeof testBridge>>;
}
