// Restore a sentence on Wang, then remove and rebuild the article as X does
// when scrolling into replies. Within 200 ms of the article returning, the
// same sentences are faded, the restore is retained, and the bridge receives
// 0 new requests. Replay rebuilds the fixture 5 times.
import assert from "node:assert/strict";
import { PNG } from "pngjs";
import type { CheckContext } from "./run";
import { roots } from "./lib/browser";
import { atMost, toggle, waitForState, withBrowser } from "./lib/check";
import { withBridge } from "./lib/fade";
import { changedSentences, geometry } from "./lib/geometry";
import { crop, difference, poll, save, screenshot } from "./lib/pixels";
import { detachReplayCell, rebuildReplayCell } from "./lib/replay";
import { captureClip, restoreOne } from "./lib/restore";

export default async function S10(context: CheckContext) {
  const replay = context.mode === "replay";
  const viewport = replay ? { width: 950, height: 650 } : undefined;
  return withBridge(context, () => withBrowser(context, async (browser, page) => {
    const { faded, point, entry } = await restoreOne(context, browser, page, false);
    const remaining = faded.filter((id) => id !== point.id);
    const painted = [...remaining, ...entry.key ?? []].sort((a, b) => a - b);
    await page.evaluate(() => window.scrollTo(0, 0));
    const unscrolled = await geometry(page);
    const sampleId = remaining.find((id) => unscrolled.sentences[id - 1].some((rect) => rect.width > 16));
    assert.ok(sampleId, "No faded sentence to track after the rebuild");
    if (replay) await page.evaluate((top) => window.scrollTo(0, top - 300), unscrolled.sentences[sampleId - 1][0].y);
    const scroll = await page.evaluate(() => scrollY);
    const layout = await geometry(page);
    const sentinel = layout.sentences[sampleId - 1].find((rect) => rect.width > 16 && rect.y >= 0);
    assert.ok(sentinel, "No visible portion of the tracked sentence");
    const whole = {
      x: 0, y: -scroll, width: page.viewportSize()!.width,
      height: Math.ceil(scroll + Math.max(...layout.sentences.flat().map((rect) => rect.y + rect.height))),
    };
    const pageGeometry = (geometry: typeof layout) => ({
      ...geometry,
      sentences: geometry.sentences.map((rects) => rects.map((rect) => ({
        ...rect, x: rect.x + 3, y: rect.y + scroll, width: rect.width - 6,
      }))),
    });
    await page.evaluate((selector) => {
      const win = window as unknown as { verifyDocReturned: number };
      let present = !!document.querySelector(selector);
      new MutationObserver(() => {
        const now = !!document.querySelector(selector);
        if (now && !present) win.verifyDocReturned = Date.now();
        present = now;
      }).observe(document, { childList: true, subtree: true });
    }, roots.wang);

    const session = await browser.context.newCDPSession(page);
    try {
      await toggle(page);
      await waitForState(page, "picks-ready");
      await Bun.sleep(180);
      const original = await captureClip(page, session, whole);
      await toggle(page);
      await waitForState(page, "faded");
      await Bun.sleep(180);
      const before = await captureClip(page, session, whole);
      const beyond = sentinel.y + sentinel.height > (page.viewportSize()?.height ?? 900);
      const expected = beyond ? (await captureClip(page, session, sentinel)).png :
        crop((await screenshot(page)).png, sentinel);
      const frames: { at: number; data: string }[] = [];
      if (!beyond) {
        session.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
          void session.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
          if (metadata.timestamp) frames.push({ at: metadata.timestamp * 1000, data });
        });
        await session.send("Page.startScreencast", {
          format: "png", maxWidth: page.viewportSize()!.width,
          maxHeight: page.viewportSize()!.height, everyNthFrame: 1,
        });
      }
      assert.deepEqual(changedSentences(original.png, before.png, pageGeometry(layout)), painted, "Initial faded and marked pixels");
      const requests = (await context.bridge.requests()).length;
      const times: number[] = [];
      let deepest = 0;
      for (let i = 0; i < (replay ? 5 : 1); i++) {
        if (replay) {
          await detachReplayCell(page);
        } else {
          for (let step = 0; step < 12; step++) {
            const y = await page.evaluate(() => {
              window.scrollTo(0, document.documentElement.scrollHeight);
              return window.scrollY;
            });
            deepest = Math.max(deepest, y);
            await Bun.sleep(600);
            if (!(await page.locator(roots.wang).count())) break;
          }
        }
        assert.equal(await page.locator(roots.wang).count(), 0, `Article stayed mounted through scrollY=${deepest}`);
        await waitForState(page, "idle", 1000);
        if (replay) await rebuildReplayCell(page, scroll);
        else await page.evaluate(() => window.scrollTo(0, 0));
        const returned = await page.evaluate(() => (window as unknown as { verifyDocReturned: number }).verifyDocReturned);
        assert.ok(returned, "Missing DOM return timestamp");
        let capturePending = false;
        const capture = () => {
          if (beyond || capturePending) return;
          capturePending = true;
          void session.send("Page.captureScreenshot", { format: "png", optimizeForSpeed: true })
            .then(({ data }) => { frames.push({ at: Date.now(), data }); })
            .catch(() => {}).finally(() => { capturePending = false; });
        };
        let cursor = frames.findIndex(({ at }) => at >= returned);
        const matching: { at: number; png: PNG }[] = [];
        const first = await poll(async () => {
          if (beyond) {
            const shot = await captureClip(page, session, sentinel);
            return difference(shot.png, expected) === 0 ? shot : undefined;
          }
          capture();
          if (cursor < 0) cursor = frames.findIndex(({ at }) => at >= returned);
          if (cursor < 0) return;
          while (cursor < frames.length) {
            const frame = frames[cursor++];
            const viewport = PNG.sync.read(Buffer.from(frame.data, "base64"));
            if (viewport.width !== page.viewportSize()!.width || viewport.height !== page.viewportSize()!.height) continue;
            const png = crop(viewport, sentinel);
            if (difference(png, expected) === 0) matching.push({ at: frame.at, png });
          }
          const earliest = matching.sort((a, b) => a.at - b.at)[0];
          if (earliest && (earliest.at - returned <= 200 || Date.now() - earliest.at >= 80)) return earliest;
        }, (frame) => !!frame, 2000);
        assert.ok(first);
        const ms = Math.round(first.at - returned);
        times.push(ms);
        await save(`${context.evidence}/rebuild-${i + 1}-first`, first.png);
        await Bun.write(`${context.evidence}/rebuild-${i + 1}-timing.json`, JSON.stringify({
          returned, firstFrame: first.at, samples: frames.filter(({ at }) => at >= returned).map(({ at }) => at),
        }));
        atMost(ms, 200, "Rebuilt article to faded pixels");
        await waitForState(page, "faded", 1000);
        const after = await captureClip(page, session, whole);
        const rebuilt = await geometry(page);
        assert.equal(rebuilt.doc.key, layout.doc.key);
        assert.deepEqual(changedSentences(original.png, after.png, pageGeometry(rebuilt)), painted, "Faded and marked sentences after rebuild");
        await save(`${context.evidence}/rebuild-${i + 1}-full`, after.png);
      }

      if (!beyond) await session.send("Page.stopScreencast");
      const extra = (await context.bridge.requests()).length - requests;
      assert.equal(extra, 0);
      return `${times.length} rebuild(s) in ${times.join("/")} ms, same ${remaining.length} fades and restored sentence ${point.id}, ${extra} additional requests${replay ? "" : `, scrolled to ${deepest}px`}`;
    } finally {
      await session.detach();
    }
  }, true, viewport));
}
