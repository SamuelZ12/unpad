import assert from "node:assert/strict";
import type { Page } from "playwright";
import { PNG } from "pngjs";
import type { CacheKey, Selection } from "../../../src/shared/types";
import type { SelectRequest } from "../../../src/shared/wire";
import type { CheckContext } from "../run";
import { state, type Reference } from "./browser";
import { atMost, toggle, waitForState, withBrowser } from "./check";
import { changedSentences, geometry, installGeometry, regionsChanged } from "./geometry";
import { save, screenshot, screenshotBytes } from "./pixels";

type Browser = Parameters<Parameters<typeof withBrowser>[1]>[0];

export async function cacheEntry(context: CheckContext, cacheKey: string | null): Promise<SelectRequest & {
  cacheKey: CacheKey; selection: Selection;
}> {
  assert.ok(cacheKey, "Bridge did not log a cache key");
  return Bun.file(`${context.bridge.data}/cache/${cacheKey}.json`).json();
}

export function pickedFades(entry: Awaited<ReturnType<typeof cacheEntry>>) {
  const selection = entry.selection;
  return selection.kind === "keep" ? entry.sentences.flatMap((_, i) =>
    selection.keep.some((id) => id === i + 1) ? [] : [i + 1]) : [];
}

export async function studyFade(
  context: CheckContext, browser: Browser, page: Page, name: Reference, minimum: number, label: string = name,
) {
  await installGeometry(browser.context);
  await page.setViewportSize({ width: 1280, height: name === "warp" ? 4900 : 3700 });
  const index = (await context.bridge.requests()).length;
  await browser.open(page, name);
  await page.evaluate(() => document.fonts.ready);
  let response: Awaited<ReturnType<typeof context.bridge.waitForRequest>> | undefined;
  let failure: unknown;
  const pending = context.bridge.waitForRequest(index).then((row) => { response = row; }, (error) => { failure = error; });
  const frames: Awaited<ReturnType<typeof screenshotBytes>>[] = [];
  try {
    do {
      const start = Date.now();
      frames.push(await screenshotBytes(page));
      while (frames.length > 60) frames.shift();
      await Bun.sleep(Math.max(0, start + 50 - Date.now()));
    } while (!failure && (!response || Date.now() < Date.parse(response.time) + response.ms + 1100));
  } finally {
    await pending;
  }
  if (failure) throw failure;
  assert.ok(response);
  assert.equal(response.result, "keep", JSON.stringify(response));
  const expected = pickedFades(await cacheEntry(context, response.cacheKey));
  assert.ok(expected.length >= minimum, `Bridge faded ${expected.length}, expected at least ${minimum}`);
  assert.deepEqual(await state(page), { view: "faded", faded: expected.length });
  const layout = await geometry(page);
  const settled = await screenshot(page);
  await toggle(page);
  await waitForState(page, "picks-ready");
  await Bun.sleep(180);
  const original = await screenshot(page);
  await toggle(page);
  await waitForState(page, "faded");
  await save(context.evidence + "/" + label + "-original", original.png);
  await save(context.evidence + "/" + label + "-faded", settled.png);

  const changed = changedSentences(original.png, settled.png, layout);
  assert.deepEqual(changed.filter((id) => !expected.includes(id)), [], `Unexpected pixel changes, changed ids ${changed}`);
  assert.ok(changed.length >= minimum, `Saw ${changed.length} faded sentences of ${expected.length} in screenshot`);
  if (name === "wang") assert.ok(layout.protectedText.length >= 2, "Title and byline were not both located");
  const protectedPixels = regionsChanged(original.png, settled.png, layout.protectedText);
  assert.equal(protectedPixels, 0, "Title/byline pixels changed");
  assert.equal(layout.excludedHits, 0, "Selection spans excluded content");

  const responseAt = Date.parse(response.time) + response.ms;
  await Bun.write(context.evidence + "/" + label + "-frames.json", JSON.stringify({ responseAt, samples: frames.map(({ at }) => at) }));
  const first = frames.find((frame) => {
    if (frame.at < responseAt) return false;
    const ids = changedSentences(original.png, PNG.sync.read(frame.bytes), layout);
    return ids.filter((id) => expected.includes(id)).length >= minimum &&
      ids.every((id) => expected.includes(id));
  });
  assert.ok(first, `No qualifying screenshot in ${frames.length} samples`);
  const elapsed = first.at - responseAt;
  await Bun.write(context.evidence + "/" + label + "-first.png", first.bytes);
  atMost(elapsed, 1000, "Bridge response to faded pixels");
  return { expected, original, settled, layout, elapsed, response, protectedPixels, observed: changed.length };
}


export async function withBridge<T>(context: CheckContext, run: () => Promise<T>) {
  await context.bridge.start();
  try { return await run(); } finally { await context.bridge.stop(); }
}
