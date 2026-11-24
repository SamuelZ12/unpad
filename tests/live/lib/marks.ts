import assert from "node:assert/strict";
import type { Page } from "playwright";
import type { PNG } from "pngjs";
import { collapse } from "../../../src/core/segment";
import { maxMarks } from "../../../src/shared/config";
import { cacheEntry, pickedFades } from "./fade";
import { visible } from "./geometry";
import { crop, type Box } from "./pixels";

export async function painted(page: Page) {
  const result = await page.evaluate(() => ({
    marked: Number(document.documentElement.dataset.fillerCutMarked),
    faded: Number(document.documentElement.dataset.fillerCutFaded),
    marks: Array.from(CSS.highlights.get("filler-cut-key") ?? [], (range) => range.toString()),
    fades: Array.from(CSS.highlights.get("filler-cut") ?? [], (range) => range.toString()),
  }));
  return { ...result, marks: result.marks.map(collapse).sort(), fades: result.fades.map(collapse).sort() };
}

export function assertMarkedSelection(
  entry: Awaited<ReturnType<typeof cacheEntry>>, paint: Awaited<ReturnType<typeof painted>>,
) {
  const fades = pickedFades(entry);
  const marks = entry.key;
  assert.ok(marks && marks.length >= 1 && marks.length <= maxMarks(entry.sentences.length));
  assert.ok(marks.every((id) => !fades.includes(id)), "A key pick was also faded");
  assert.deepEqual(paint, {
    marked: marks.length, faded: fades.length,
    marks: marks.map((id) => entry.sentences[id - 1]).sort(),
    fades: fades.map((id) => entry.sentences[id - 1]).sort(),
  });
  return marks;
}

// The paint animates over 160 ms, and a tall viewport draws slow frames.
export async function settled(page: Page, on: boolean) {
  await page.waitForFunction((target) =>
    getComputedStyle(document.documentElement).getPropertyValue("--filler-cut-mark-opacity").trim() === target,
  on ? "1" : "0", { timeout: 3000 });
}

export function tintedPixels(before: PNG, after: PNG, boxes: Box[]) {
  const tint = [255, 214, 10];
  let count = 0;
  for (const box of boxes.filter((box) => visible(before, box))) {
    const original = crop(before, box);
    const marked = crop(after, box);
    for (let i = 0; i < original.data.length; i += 4) {
      // The paper-like backgrounds are nearly neutral.
      const red = original.data[i];
      if (Math.abs(red - original.data[i + 1]) > 12 || Math.abs(red - original.data[i + 2]) > 12) continue;
      if ([0.42, 0.26].some((alpha) => tint.every((channel, j) =>
        Math.abs(marked.data[i + j] - (original.data[i + j] * (1 - alpha) + channel * alpha)) <= 2))) count++;
    }
  }
  return count;
}
