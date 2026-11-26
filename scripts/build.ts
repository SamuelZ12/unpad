import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { bridgeAddress, hostPermission } from "../src/shared/connection";
import manifest from "../src/manifest.json";

const bridge = process.env.BRIDGE_URL && bridgeAddress(process.env.BRIDGE_URL);
if (process.env.BRIDGE_URL && !bridge) throw new Error("BRIDGE_URL must be an HTTP or HTTPS origin");
const dev = process.env.FILLER_CUT_DEV === "1";
const authOrigin = dev && process.env.FILLER_CUT_AUTH_ORIGIN
  ? bridgeAddress(process.env.FILLER_CUT_AUTH_ORIGIN) : "";
if (dev && process.env.FILLER_CUT_AUTH_ORIGIN && !authOrigin) throw new Error("Invalid development auth origin");
const [prompt, keyPrompt] = await Promise.all(["prompt.txt", "key-prompt.txt"].map((file) =>
  Bun.file(new URL(`../bridge/${file}`, import.meta.url)).text()));

const outdir = process.env.FILLER_CUT_OUTDIR ?? "dist/extension";
await mkdir(outdir, { recursive: true });

const build = await Bun.build({
  entrypoints: ["src/content/main.ts", "src/content/page.ts", "src/background/sw.ts", "src/popup/popup.ts",
    "src/options/options.ts", "src/options/callback.ts"],
  outdir,
  naming: "[name].js",
  target: "browser",
  format: "iife",
  minify: { syntax: true },
  define: {
    "process.env.BRIDGE_URL": JSON.stringify(bridge || ""),
    "process.env.FILLER_CUT_DEV": JSON.stringify(dev ? "1" : "0"),
    "process.env.FILLER_CUT_AUTH_ORIGIN": JSON.stringify(authOrigin || ""),
    "process.env.FILLER_CUT_PROMPT": JSON.stringify(prompt),
    "process.env.FILLER_CUT_KEY_PROMPT": JSON.stringify(keyPrompt),
  },
});
if (!build.success) throw new AggregateError(build.logs, "Extension build failed");

// Chrome keeps running its cached copy of an unpacked extension's worker after a browser restart,
// even when the file and the manifest version changed. A new file name per build cannot be stale.
const digest = new Bun.CryptoHasher("sha256").update(await Bun.file(`${outdir}/sw.js`).bytes()).digest("hex");
const worker = `sw-${digest.slice(0, 8)}.js`;
for (const file of await readdir(outdir)) {
  if (/^sw-[0-9a-f]{8}\.js$/.test(file)) await rm(`${outdir}/${file}`);
}
await rename(`${outdir}/sw.js`, `${outdir}/${worker}`);

await Promise.all([
  ...["popup.html", "popup.css"].map((file) => [`popup/${file}`, file]),
  ...["options.html", "options.css", "callback.html"].map((file) => [`options/${file}`, file]),
  ...Object.values(manifest.icons).map((file) => [file, file]),
].map(([source, target]) => Bun.write(`${outdir}/${target}`, Bun.file(`src/${source}`))));

await Bun.write(`${outdir}/manifest.json`, JSON.stringify({
  ...manifest,
  commands: { ...manifest.commands, "toggle-lens": {
    ...manifest.commands["toggle-lens"], description: `Toggle ${manifest.name} on this page`,
  } },
  background: { ...manifest.background, service_worker: worker },
  ...(bridge && { host_permissions: [hostPermission(bridge)] }),
}, null, 2) + "\n");
