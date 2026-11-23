import { expect, test } from "bun:test";

test("build emits the MV3 extension with its bridge permission", async () => {
  const build = Bun.spawn([process.execPath, "run", "build"], {
    env: { ...process.env, BRIDGE_URL: "https://bridge.example:8443" },
    stdout: "inherit",
    stderr: "inherit",
  });
  expect(await build.exited).toBe(0);

  const dir = "dist/extension";
  const manifest = await Bun.file(`${dir}/manifest.json`).json();
  expect(manifest.manifest_version).toBe(3);
  expect(manifest.host_permissions).toEqual(["https://bridge.example/*"]);
  expect(manifest.content_scripts).toEqual([
    { matches: ["https://x.com/*", "https://claude.com/*"], js: ["main.js"] },
  ]);
  expect(await Bun.file(`${dir}/main.js`).exists()).toBe(true);
  expect(await Bun.file(`${dir}/${manifest.background.service_worker}`).exists()).toBe(true);
});
