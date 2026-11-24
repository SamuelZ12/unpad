import { mkdir, readdir, rename, rm } from "node:fs/promises";
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
  minify: { syntax: true },
  define: {
    "process.env.BRIDGE_URL": JSON.stringify(BRIDGE_URL),
    "process.env.FILLER_CUT_DEV": JSON.stringify(process.env.FILLER_CUT_DEV ?? "0"),
  },
});

// Chrome keeps running its cached copy of an unpacked extension's worker after a browser restart,
// even when the file and the manifest version changed. A new file name per build cannot be stale.
const digest = new Bun.CryptoHasher("sha256").update(await Bun.file(`${outdir}/sw.js`).bytes()).digest("hex");
const worker = `sw-${digest.slice(0, 8)}.js`;
for (const file of await readdir(outdir)) {
  if (/^sw-[0-9a-f]{8}\.js$/.test(file)) await rm(`${outdir}/${file}`);
}
await rename(`${outdir}/sw.js`, `${outdir}/${worker}`);

await Bun.write(`${outdir}/manifest.json`, JSON.stringify({
  ...manifest,
  background: { ...manifest.background, service_worker: worker },
  // Chrome match patterns grant access by scheme and host.
  host_permissions: [`${bridge.protocol}//${bridge.hostname}/*`],
}, null, 2) + "\n");
