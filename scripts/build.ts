import { mkdir } from "node:fs/promises";
import { BRIDGE_URL } from "../src/shared/config";
import manifest from "../src/manifest.json";

const bridge = new URL(BRIDGE_URL);
if (bridge.protocol !== "http:" && bridge.protocol !== "https:") {
  throw new Error("BRIDGE_URL must use HTTP or HTTPS");
}

const outdir = "dist/extension";
await mkdir(outdir, { recursive: true });

await Bun.build({
  entrypoints: ["src/content/main.ts", "src/background/sw.ts"],
  outdir,
  naming: "[name].js",
  target: "browser",
  format: "iife",
  define: {
    "process.env.BRIDGE_URL": JSON.stringify(BRIDGE_URL),
    "process.env.FILLER_CUT_DEV": JSON.stringify(process.env.FILLER_CUT_DEV ?? "0"),
  },
});

await Bun.write(`${outdir}/manifest.json`, JSON.stringify({
  ...manifest,
  // Chrome match patterns grant access by scheme and host.
  host_permissions: [`${bridge.protocol}//${bridge.hostname}/*`],
}, null, 2) + "\n");
