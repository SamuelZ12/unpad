import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";
import manifest from "../src/manifest.json";

const dist = resolve("dist");
await mkdir(dist, { recursive: true });
const temporary = await mkdtemp(resolve(dist, ".zip-"));
const extension = resolve(temporary, "extension");
const archive = resolve(temporary, "extension.zip");
const output = resolve(dist, `unpad-${manifest.version}.zip`);

try {
  const { BRIDGE_URL, FILLER_CUT_DEV, ...env } = process.env;
  const build = Bun.spawn([process.execPath, "scripts/build.ts"], {
    env: { ...env, FILLER_CUT_OUTDIR: extension }, stdout: "inherit", stderr: "inherit",
  });
  if (await build.exited) throw new Error("Extension build failed");
  const zip = Bun.spawn(["zip", "-q", "-r", archive, "."], { cwd: extension, stderr: "inherit" });
  if (await zip.exited) throw new Error("Could not create extension zip");
  await rename(archive, output);
  console.log(output);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
