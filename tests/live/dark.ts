import assert from "node:assert/strict";
import type { CheckContext } from "./run";
import { withBrowser } from "./lib/check";
import { studyFade, withBridge } from "./lib/fade";
import { visible } from "./lib/geometry";
import { crop } from "./lib/pixels";

export default async function dark(context: CheckContext) {
  return withBridge(context, () => withBrowser(context, async (browser, page) => {
    await page.emulateMedia({ colorScheme: "dark" });
    const { layout, expected, original, settled } = await studyFade(context, browser, page, "wang", 3, "dark");
    let samples = 0;
    let maxError = 0;
    const backgrounds = new Set<number>();
    for (const id of expected) {
      const fg = layout.colors[id - 1].match(/^rgb\((\d+), (\d+), (\d+)\)$/)?.slice(1).map(Number);
      if (!fg) continue;
      for (const rect of layout.sentences[id - 1].filter((box) => visible(original.png, box))) {
        const before = crop(original.png, rect);
        const after = crop(settled.png, rect);
        const histogram = new Map<number, number>();
        for (let i = 0; i < before.data.length; i += 4) {
          const color = before.data.readUInt32LE(i);
          histogram.set(color, (histogram.get(color) ?? 0) + 1);
        }
        const bg = [...histogram].sort((a, b) => b[1] - a[1])[0][0];
        backgrounds.add(bg);
        for (let i = 0; i < before.data.length; i += 4) {
          if (fg.some((channel, offset) => before.data[i + offset] !== channel)) continue;
          const error = fg.map((channel, offset) =>
            Math.abs(after.data[i + offset] - Math.round(0.4 * channel + 0.6 * ((bg >>> (8 * offset)) & 255))));
          maxError = Math.max(maxError, ...error);
          samples++;
        }
      }
    }
    assert.ok(samples > 0, "No solid foreground pixels found");
    assert.ok(maxError <= 8, `${samples} solid pixels, maximum error ${maxError} levels/channel (limit 8)`);
    return `${samples} solid text pixels, max error ${maxError} levels/channel, background ${[...backgrounds].map((bg) => (bg & 0xffffff).toString(16).padStart(6, "0")).join("/")}`;
  }));
}
