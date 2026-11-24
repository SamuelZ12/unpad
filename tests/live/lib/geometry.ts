import type { BrowserContext, Page } from "playwright";
import assert from "node:assert/strict";
import { crop, difference, type Box } from "./pixels";
import type { PNG } from "pngjs";
import type { Geometry } from "./geometry-page";

let setup: Promise<string> | undefined;
export async function installGeometry(context: BrowserContext) {
  setup ??= (async () => {
    const build = await Bun.build({
      entrypoints: ["tests/live/lib/geometry-page.ts"], target: "browser", format: "iife",
      define: { "process.env.BRIDGE_URL": '""' },
    });
    return build.outputs[0].text();
  })();
  await context.addInitScript({ content: await setup });
}

export async function geometry(page: Page): Promise<Geometry> {
  const result = await page.evaluate(() => window.fillerCutGeometry());
  assert.ok(result, "No sentence geometry on page");
  return result;
}

export function visible(image: PNG, box: Box) {
  return box.width > 2 && box.height > 2 && box.x >= 0 && box.y >= 0 &&
    box.x + box.width <= image.width && box.y + box.height <= image.height;
}

export function regionsChanged(before: PNG, after: PNG, boxes: Box[]) {
  return boxes.filter((box) => visible(before, box) && visible(after, box)).reduce((count, box) =>
    count + difference(crop(before, box), crop(after, box)), 0);
}

export function changedSentences(before: PNG, after: PNG, { sentences }: Geometry, threshold = 8) {
  return sentences.flatMap((boxes, index) => regionsChanged(before, after, boxes) > threshold ? [index + 1] : []);
}
