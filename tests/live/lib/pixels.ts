import type { Locator, Page } from "playwright";
import { PNG } from "pngjs";

export interface Box { x: number; y: number; width: number; height: number }

export function crop(image: PNG, box: Box) {
  const x = Math.max(0, Math.floor(box.x));
  const y = Math.max(0, Math.floor(box.y));
  const width = Math.min(image.width, Math.ceil(box.x + box.width)) - x;
  const height = Math.min(image.height, Math.ceil(box.y + box.height)) - y;
  if (width <= 0 || height <= 0) throw new Error("Crop outside screenshot");
  const result = new PNG({ width, height });
  PNG.bitblt(image, result, x, y, width, height, 0, 0);
  return result;
}

export function difference(a: PNG, b: PNG) {
  if (a.width !== b.width || a.height !== b.height) return Infinity;
  let changed = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (a.data.readUInt32LE(i) !== b.data.readUInt32LE(i)) changed++;
  }
  return changed;
}

export async function screenshot(page: Page) {
  const png = PNG.sync.read(await page.screenshot({ scale: "css", timeout: 8000 }));
  return { at: Date.now(), png };
}

export async function docCrop(root: Locator) {
  await root.scrollIntoViewIfNeeded();
  const box = await root.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const { x, y, width, height } = range.getBoundingClientRect();
    return { x, y, width, height };
  });
  if (!box.width || !box.height) throw new Error("Doc has no bounding box");
  // Crop the visible prose above any bottom-of-viewport call to action.
  const top = Math.max(0, box.y);
  return crop((await screenshot(root.page())).png, {
    ...box, y: top, height: Math.min(box.y + box.height - top, 450),
  });
}

export async function save(path: string, png: PNG) {
  await Bun.write(path + ".png", PNG.sync.write(png));
}

export async function poll<T>(read: () => Promise<T>, done: (value: T) => boolean, timeout: number) {
  const end = Date.now() + timeout;
  while (true) {
    const start = Date.now();
    const value = await read();
    if (done(value)) return value;
    if (Date.now() >= end) throw new Error(`Timed out after ${timeout} ms, last sample ${JSON.stringify(value)}`);
    await Bun.sleep(Math.max(0, start + 50 - Date.now()));
  }
}
