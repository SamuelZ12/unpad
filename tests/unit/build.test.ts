import { expect, test } from "bun:test";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("build emits the MV3 extension with its bridge permission", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "filler-build-"));
  try {
    await symlink(join(import.meta.dir, "../../src"), join(cwd, "src"), "dir");
    const build = Bun.spawn([process.execPath, join(import.meta.dir, "../../scripts/build.ts")], {
      cwd,
      env: { ...process.env, BRIDGE_URL: "https://bridge.example:8443" },
      stdout: "inherit",
      stderr: "inherit",
    });
    expect(await build.exited).toBe(0);

    const dir = join(cwd, "dist/extension");
    const manifest = await Bun.file(join(dir, "manifest.json")).json();
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.host_permissions).toEqual(["https://bridge.example/*"]);
    expect(manifest.content_scripts).toEqual([
      { matches: ["https://x.com/*", "https://claude.com/*"], js: ["main.js"] },
    ]);
    expect(await Bun.file(join(dir, "main.js")).text()).not.toContain("fillerCutDebug");
    expect(await Bun.file(join(dir, manifest.background.service_worker)).exists()).toBe(true);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
