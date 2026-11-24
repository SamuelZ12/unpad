import assert from "node:assert/strict";
import type { CDPSession, Page } from "playwright";
import { PNG } from "pngjs";
import type { CheckContext } from "../run";
import { state } from "./browser";
import { atMost, toggle, waitForState, withBrowser } from "./check";
import { cacheEntry, pickedFades } from "./fade";
import { changedSentences, geometry, installGeometry } from "./geometry";
import { crop, difference, poll, save, screenshot, type Box } from "./pixels";

type Browser = Parameters<Parameters<typeof withBrowser>[1]>[0];

export async function findClick(page: Page, ids: number[], visibleFades = 1) {
  const height = page.viewportSize()?.height ?? 900;
  const bottom = height - 80;
  const target = Math.min(360, height * 0.45);
  for (const id of ids) {
    const rects = (await geometry(page)).sentences[id - 1];
    if (!rects.length) continue;
    await page.evaluate((delta) => window.scrollBy(0, delta), rects[0].y - target);
    const { sentences } = await geometry(page);
    if (visibleFades > 1 && ids.filter((id) => sentences[id - 1].some((rect) =>
      rect.width > 16 && rect.y > 60 && rect.y + rect.height < bottom)).length < visibleFades) continue;
    const current = sentences[id - 1]
      .filter((rect) => rect.width > 16 && rect.y > 60 && rect.y < bottom)
      .sort((a, b) => b.width - a.width);
    for (const rect of current) {
      const x = rect.x + rect.width / 2;
      const y = rect.y + rect.height / 2;
      if (await page.evaluate(({ x, y }) => {
        const element = document.elementFromPoint(x, y);
        return !!element && !element.closest("a, button, [role=button]") &&
          !!element.closest("[data-article-body-html], [data-testid=twitterArticleRichTextView]");
      }, { x, y })) return { id, rect, x, y };
    }
  }
  throw new Error(`No unobstructed sentence click point with ${visibleFades} fades in view for ${ids.join(",")}`);
}

export async function captureClip(page: Page, session: CDPSession, rect: Box, beyond = true) {
  const { x, y } = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
  const clip = {
    x: Math.floor(x + rect.x), y: Math.floor(y + rect.y),
    width: Math.ceil(rect.width), height: Math.ceil(rect.height), scale: 1,
  };
  const result = await session.send("Page.captureScreenshot", {
    format: "png", captureBeyondViewport: beyond, optimizeForSpeed: true, clip,
  });
  return { at: Date.now(), png: PNG.sync.read(Buffer.from(result.data, "base64")) };
}

export async function restoreOne(context: CheckContext, browser: Browser, page: Page, measure: boolean) {
  await installGeometry(browser.context);
  if (measure) await page.setViewportSize({ width: 950, height: 650 });
  const index = (await context.bridge.requests()).length;
  await browser.open(page, "wang");
  const first = await waitForState(page, "faded");
  if (measure) {
    await page.waitForLoadState("load", { timeout: 8000 }).catch(() => {});
    await Bun.sleep(500);
  }
  await page.evaluate(() => document.fonts.ready);
  const row = await context.bridge.waitForRequest(index);
  const entry = await cacheEntry(context, row.cacheKey);
  const faded = pickedFades(entry);
  const point = await findClick(page, faded);
  const markClick = () => page.evaluate(() => window.addEventListener("click", (event) => {
    document.documentElement.dataset.verifyClickAt = String(performance.timeOrigin + event.timeStamp);
  }, { once: true, capture: true }));
  const clickTime = async () => Number(await page.locator("html").getAttribute("data-verify-click-at"));
  if (!measure) {
    await markClick();
    await page.mouse.click(point.x, point.y);
    await poll(() => state(page), (value) => value.faded === first.faded - 1, 1000);
    return { point, first, faded, entry, clickAt: await clickTime(), elapsed: 0 };
  }

  const session = await browser.context.newCDPSession(page);
  try {
    const viewport = page.viewportSize()!;
    const frames: { at: number; data: string }[] = [];
    session.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
      void session.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
      if (metadata.timestamp) frames.push({ at: metadata.timestamp * 1000, data });
    });
    function frameCrop(frame: { at: number; data: string }) {
      const png = PNG.sync.read(Buffer.from(frame.data, "base64"));
      if (png.width !== viewport.width || png.height !== viewport.height) return;
      return { at: frame.at, png: crop(png, point.rect) };
    }

    await session.send("Page.startScreencast", {
      format: "png", maxWidth: viewport.width, maxHeight: viewport.height, everyNthFrame: 1,
    });
    await toggle(page);
    await waitForState(page, "picks-ready");
    await Bun.sleep(190);
    const original = crop((await screenshot(page)).png, point.rect);
    await toggle(page);
    await waitForState(page, "faded");
    await Bun.sleep(180);
    const before = await screenshot(page);
    assert.ok(difference(crop(before.png, point.rect), original) > 8, "Clicked sentence had no faded pixels before click");

    await markClick();
    await page.evaluate(() => {
      const html = document.documentElement;
      const count = html.dataset.fillerCutFaded;
      const observe = new MutationObserver(() => {
        if (html.dataset.fillerCutFaded === count) return;
        html.dataset.verifyRestoreAt = String(performance.timeOrigin + performance.now());
        observe.disconnect();
      });
      observe.observe(html, { attributes: true, attributeFilter: ["data-filler-cut-faded"] });
    });
    await page.mouse.click(point.x, point.y);
    const clickAt = await clickTime();
    assert.ok(clickAt > 0);
    let capturePending = false;
    const capture = () => {
      if (capturePending) return;
      capturePending = true;
      void session.send("Page.captureScreenshot", { format: "png", optimizeForSpeed: true })
        .then(({ data }) => { frames.push({ at: Date.now(), data }); })
        .catch(() => {}).finally(() => { capturePending = false; });
    };
    let cursor = frames.findIndex(({ at }) => at >= clickAt);
    const timings: { at: number; changed: number }[] = [];
    const matching: { at: number; png: PNG }[] = [];
    const after = await poll(async () => {
      capture();
      if (cursor < 0) cursor = frames.findIndex(({ at }) => at >= clickAt);
      if (cursor < 0) return;
      while (cursor < frames.length) {
        const frame = frameCrop(frames[cursor++]);
        if (!frame) continue;
        const changed = difference(frame.png, original);
        timings.push({ at: frame.at, changed });
        if (changed === 0) matching.push(frame);
      }
      const earliest = matching.sort((a, b) => a.at - b.at)[0];
      if (earliest && (earliest.at - clickAt <= 100 || Date.now() - earliest.at >= 80)) return earliest;
    }, (frame) => !!frame, 1000);
    await session.send("Page.stopScreencast");
    assert.ok(after, "No screencast frame matched the original sentence");
    const elapsed = after.at - clickAt;
    const restoreAt = Number(await page.locator("html").getAttribute("data-verify-restore-at"));
    await Bun.write(context.evidence + "/timing.json", JSON.stringify({
      clickAt, restoreAt, firstRestoredFrame: after.at, screencastFrames: timings,
    }, null, 2));
    assert.equal((await state(page)).faded, first.faded - 1);
    const restored = await screenshot(page);
    const layout = await geometry(page);
    const changed = changedSentences(before.png, restored.png, layout, 0);
    await save(context.evidence + "/before-click", before.png);
    await save(context.evidence + "/after-click", restored.png);
    await save(context.evidence + "/clicked-sentence", after.png);
    assert.deepEqual(changed, [point.id], `Changed sentence ids ${changed}`);
    atMost(elapsed, 100, `Click to restored pixels (state in ${(restoreAt - clickAt).toFixed(1)} ms)`);

    const scroll = await page.evaluate(() => scrollY);
    async function stillRestored(label: string) {
      await page.evaluate((y) => window.scrollTo(0, y), scroll);
      const image = (await screenshot(page)).png;
      await save(context.evidence + "/" + label, image);
      // A replayed article can acquire Chromium's focus outline on Shift.
      // Compare the interior of the text fragments, clear of that outline.
      const prose = {
        ...layout,
        sentences: layout.sentences.map((rects) => rects.map((rect) => ({
          ...rect, x: rect.x + 3, width: rect.width - 6,
        }))),
      };
      assert.deepEqual(changedSentences(restored.png, image, prose, 0), [], label);
    }
    await toggle(page);
    await waitForState(page, "picks-ready");
    await Bun.sleep(250);
    await toggle(page);
    await waitForState(page, "faded");
    await Bun.sleep(250);
    await stillRestored("after-toggle");
    await page.keyboard.down("Shift");
    await waitForState(page, "revealed", 1000);
    await page.keyboard.up("Shift");
    await waitForState(page, "faded");
    await Bun.sleep(250);
    await stillRestored("after-hold");
    return { point, first, faded, entry, clickAt, elapsed };
  } finally {
    await session.detach();
  }
}
