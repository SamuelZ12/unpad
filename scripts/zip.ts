import { copyFile, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";
import manifest from "../src/manifest.json";
import packageInfo from "../package.json";

if (manifest.version !== packageInfo.version) throw new Error("Manifest and package versions differ");

const dist = resolve("dist");
await mkdir(dist, { recursive: true });
const temporary = await mkdtemp(resolve(dist, ".zip-"));
const extension = resolve(temporary, "extension");
const archive = resolve(temporary, "extension.zip");
const output = resolve(dist, `${packageInfo.name}-${manifest.version}.zip`);

try {
  const build = Bun.spawn([process.execPath, "scripts/build.ts"], {
    env: { ...process.env, BRIDGE_URL: "", FILLER_CUT_DEV: "0", FILLER_CUT_OUTDIR: extension }, stdout: "inherit", stderr: "inherit",
  });
  if (await build.exited) throw new Error("Extension build failed");
  await copyFile("LICENSE", resolve(extension, "LICENSE"));
  const zip = Bun.spawn(["zip", "-q", "-r", archive, "."], { cwd: extension, env: { ...process.env, ZIPOPT: "" }, stderr: "inherit" });
  if (await zip.exited) throw new Error("Could not create extension zip");
  await rename(archive, output);
  console.log(output);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
