import assert from "node:assert/strict";
import type { CheckContext } from "./run";
import { roots } from "./lib/browser";
import { toggle, waitForState, withBrowser } from "./lib/check";
import { assertCuts, expandRun, referenceCut, runs, sentenceTop, snapshot, withBridge } from "./lib/cut";
import { assertMarked } from "./lib/marks";
import { poll, save, screenshot } from "./lib/pixels";

export default async function S8(context: CheckContext) {
  return withBridge(context, async () => {
    const results = [];
    const schemes = context.mode === "replay" ? ["dark"] as const : ["light", "dark"] as const;
    for (const scheme of schemes) {
      results.push(await withBrowser(context, async (browser, page) => {
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
        await browser.context.addInitScript((selector) => {
          const observer = new MutationObserver(() => {
            if (document.documentElement.dataset.fillerCutState !== "waiting") return;
            const root = document.querySelector(selector);
            if (!root) return;
            Object.defineProperty(window, "verifyOriginalHtml", { value: root.outerHTML });
            observer.disconnect();
          });
          observer.observe(document, {
            subtree: true, attributes: true, attributeFilter: ["data-filler-cut-state"],
          });
        }, roots.wang);
        let cursor = (await context.bridge.events()).length;
        const { root, row, entry, ids } = await referenceCut(context, browser, page, "wang");
        const groups = runs(ids);
        const choices = groups.map((group, index) => ({ group, index }))
          .filter(({ group }) => group.at(-1)! < entry.sentences.length);
        const choice = choices.sort((a, b) => b.group.length - a.group.length)[0];
        assert.ok(choice, "S8 needs a removed run with a kept sentence after it");
        const { group, index } = choice;
        const marker = root.getByRole("button", { name: /^Show .* removed sentences?$/ }).nth(index);
        const pieces = root.locator("[data-filler-cut-restored]");

        const original = await page.evaluate(() => (window as unknown as { verifyOriginalHtml: string }).verifyOriginalHtml);
        assert.ok(original, "Original article HTML was not captured before the first cut");
        await page.evaluate(() => document.fonts.ready);

        const markerPosition = () => marker.evaluate((element) => {
          const { x, y } = element.getBoundingClientRect();
          return { x: x + scrollX, y: y + scrollY };
        });
        const position = await markerPosition();
        const kept = entry.sentences[group.at(-1)!];
        const documentTop = await sentenceTop(root, kept) + await page.evaluate(() => scrollY);
        const { remaining, top } = await expandRun(root, entry, ids, index);
        const noun = group.length === 1 ? "sentence" : "sentences";
        const button = root.getByRole("button", { name: `Hide ${group.length} ${noun}` });
        const drift = Math.abs(await sentenceTop(root, entry.sentences[group[0] - 1]) - top);
        assert.ok(drift <= 3, `Restored text starts ${drift}px from its marker`);
        assert.ok(await button.evaluate((element) => document.activeElement === element), "Focus did not move to the new control");
        await assertMarked(page, entry);
        assert.equal((await pieces.allTextContents()).join("").replace(/\s/g, ""),
          group.map((id) => entry.sentences[id - 1]).join("").replace(/\s/g, ""));
        await page.mouse.move(0, 0);
        const paints = () => pieces.evaluateAll((parts) => {
          const canvas = document.createElement("canvas").getContext("2d")!;
          function rgba(color: string) {
            canvas.clearRect(0, 0, 1, 1);
            canvas.fillStyle = color;
            canvas.fillRect(0, 0, 1, 1);
            return canvas.getImageData(0, 0, 1, 1).data;
          }
          return parts.map((part) => {
            const { color, backgroundColor, cursor } = getComputedStyle(part);
            const inherited = getComputedStyle(part.parentElement!).color;
            const foreground = rgba(color);
            const background = rgba(backgroundColor);
            const matches = (actual: Uint8ClampedArray, percent: number) => {
              const expected = rgba(`color-mix(in srgb, ${inherited} ${percent}%, transparent)`);
              return actual.every((value, i) => Math.abs(value - expected[i]) <= 1);
            };
            return { muted: matches(foreground, 55), clear: background[3] === 0, tinted: matches(background, 9), cursor };
          });
        });
        const muted = await poll(paints, (parts) => parts.length > 0 &&
          parts.every(({ muted, clear, cursor }) => muted && clear && cursor === "pointer"), 1000);

        await page.evaluate((y) => scrollBy({ top: y, behavior: "instant" }), await sentenceTop(root, kept) - 180);
        const before = await sentenceTop(root, kept);
        assert.ok(Math.abs(before - 180) <= 1, `Could not position the kept sentence (${before}px)`);
        assert.ok(Math.abs(before + await page.evaluate(() => scrollY) - documentTop) > 1,
          "Expansion did not move the kept sentence in the document");
        await save(`${context.evidence}/wang-${scheme}-expanded`, (await screenshot(page)).png);

        const point = await pieces.evaluateAll((parts) => {
          for (const part of parts.toReversed()) {
            if (part.closest("a, [role=link], button, summary")) continue;
            for (const rect of Array.from(part.getClientRects())) {
              const x = rect.left + rect.width / 2;
              const y = rect.top + rect.height / 2;
              if (document.elementFromPoint(x, y) === part) return { x, y };
            }
          }
        });
        assert.ok(point, "No visible restored fragment accepts pointer clicks");
        await page.mouse.move(point.x, point.y);
        await poll(paints, (parts) => parts.length === muted.length && parts.every(({ tinted }) => tinted), 1000);
        await save(`${context.evidence}/wang-${scheme}-hover`, (await screenshot(page)).png);

        const recuts = async () => (await context.bridge.events()).slice(cursor)
          .filter((event) => event.type === "recut");
        const verifyRecut = async () => {
          const clicks = await poll(recuts, (events) => events.length >= group.length, 5000);
          assert.deepEqual(clicks.map(({ sentenceId }) => sentenceId), group);
          assert.ok(clicks.every((event) => event.cacheKey === row.cacheKey &&
            event.text === entry.sentences[event.sentenceId - 1]));
          return clicks;
        };
        await page.mouse.click(point.x, point.y);
        await assertCuts(root, entry, ids);
        assert.equal(await pieces.count(), 0);
        assert.equal(await marker.textContent(), "···");
        const returned = await markerPosition();
        assert.ok(Math.hypot(returned.x - position.x, returned.y - position.y) <= 1,
          `Marker moved from ${JSON.stringify(position)} to ${JSON.stringify(returned)}`);
        assert.ok(await marker.evaluate((element) => document.activeElement === element), "Focus did not move to the new control");
        const recutDrift = Math.abs(await sentenceTop(root, kept) - before);
        assert.ok(recutDrift <= 1, `Kept sentence moved ${recutDrift}px during collapse`);
        await page.mouse.move(0, 0);
        await save(`${context.evidence}/wang-${scheme}-recut`, (await screenshot(page)).png);

        const firstClicks = await verifyRecut();
        cursor = (await context.bridge.events()).length;
        await page.keyboard.press("Enter");
        await assertCuts(root, entry, remaining);
        assert.ok(await button.evaluate((element) => document.activeElement === element), "Focus did not move to the new control");
        await page.keyboard.down("Shift");
        await waitForState(page, "revealed", 1000);
        assert.equal((await snapshot(root)).html, original);
        await page.keyboard.up("Shift");
        await waitForState(page, "faded");
        await assertCuts(root, entry, remaining);
        await toggle(page);
        await waitForState(page, "picks-ready");
        assert.equal((await snapshot(root)).html, original);
        await toggle(page);
        await waitForState(page, "faded");
        await assertCuts(root, entry, remaining);
        await button.focus();
        await page.keyboard.press("Enter");
        await assertCuts(root, entry, ids);
        assert.ok(await marker.evaluate((element) => document.activeElement === element), "Focus did not move to the new control");

        await toggle(page);
        await waitForState(page, "picks-ready");
        assert.equal((await snapshot(root)).html, original);

        const secondClicks = await verifyRecut();
        const clicks = [...firstClicks, ...secondClicks];
        assert.equal(new Set(clicks.map(({ id }) => id)).size, clicks.length);
        await toggle(page);
        await waitForState(page, "faded");
        return `${scheme}: expanded and collapsed run ${group.join("/")}, ${recutDrift}px kept-sentence drift, ${clicks.length} recut events`;
      }));
    }
    return results.join(" | ");
  });
}
