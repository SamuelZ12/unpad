import assert from "node:assert/strict";
import type { Page } from "playwright";
import type { PNG } from "pngjs";
import { collapse } from "../../../src/core/segment";
import { maxMarks } from "../../../src/shared/config";
import { cacheEntry, pickedCuts } from "./cut";
import { crop, type Box } from "./pixels";

export function marked(page: Page) {
  return page.evaluate(() => Array.from(CSS.highlights.get("filler-cut-key") ?? [], (range) => ({
    text: range.toString(),
    boxes: [...(range as Range).getClientRects()].map(({ x, y, width, height }) => ({ x, y, width, height })),
  })));
}

export async function assertMarked(page: Page, entry: Awaited<ReturnType<typeof cacheEntry>>) {
  const ids = entry.key ?? [];
  const ranges = await marked(page);
  assert.ok(ids.length >= 1 && ids.length <= maxMarks(entry.sentences.length));
  assert.ok(ids.every((id) => !pickedCuts(entry).includes(id)), "A marked sentence was also removed");
  assert.deepEqual(ranges.map(({ text }) => collapse(text)).sort(), ids.map((id) => entry.sentences[id - 1]).sort());
  assert.ok(ranges.every(({ boxes }) => boxes.some(({ width, height }) => width > 0 && height > 0)));
  return ranges;
}

export function tintedPixels(image: PNG, boxes: readonly Box[]) {
  let count = 0;
  for (const box of boxes) {
    if (box.width < 2 || box.height < 2 || box.x < 0 || box.y < 0 ||
      box.x + box.width > image.width || box.y + box.height > image.height) continue;
    const { data } = crop(image, box);
    for (let i = 0; i < data.length; i += 4) {
      const [r, g, b] = data.subarray(i, i + 3);
      if (r - g >= 7 && r - g <= 30 && g - b >= 35 && g - b <= 105) count++;
    }
  }
  return count;
}
