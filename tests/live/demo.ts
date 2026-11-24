import { rename } from "node:fs/promises";
import { join } from "node:path";
import type { CheckContext } from "./run";
import { launch, state } from "./lib/browser";
import { waitForState } from "./lib/check";
import { cacheEntry, expandRun, withBridge } from "./lib/cut";
import { poll } from "./lib/pixels";

export default async function demo(context: CheckContext) {
  const { bridge, evidence, mode } = context;
  await withBridge(context, async () => {
    const browser = await launch(mode, false, evidence);
    const page = browser.context.pages()[0];
    let recording: string;
    try {
      const root = await browser.open(page, "wang");
      const faded = await waitForState(page, "faded");
      await page.evaluate(() => document.fonts.ready);
      const { cacheKey } = await bridge.waitForRequest(0);
      const entry = await cacheEntry(context, cacheKey);
      recording = await page.video()!.path();

      await Bun.sleep(2000);
      await page.keyboard.down("Shift");
      await Bun.sleep(2000);
      await page.keyboard.up("Shift");
      await Bun.sleep(1000);
      const { group } = await expandRun(root, entry);
      await poll(() => state(page), (value) => value.faded === faded.faded - group.length, 1000);
      await Bun.sleep(2000);
    } finally {
      await browser.close();
    }

    const webm = join(evidence, "demo.webm");
    await rename(recording, webm);
    console.log(webm);
    const ffmpeg = Bun.which("ffmpeg");
    if (ffmpeg) {
      const mp4 = join(evidence, "demo.mp4");
      const convert = Bun.spawn([ffmpeg, "-loglevel", "error", "-i", webm, "-c:v", "libx264",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4], { stderr: "inherit" });
      if (await convert.exited !== 0) throw new Error("Could not convert demo to MP4");
      console.log(mp4);
    }
  });
}
