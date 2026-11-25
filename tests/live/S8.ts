import assert from "node:assert/strict";
import type { CheckContext } from "./run";
import { toggle, waitForState, withBrowser } from "./lib/check";
import { assertCuts, expandRun, referenceCut, runs, sentenceTop, snapshot, withBridge } from "./lib/cut";
import { assertMarked } from "./lib/marks";
import { poll, save, screenshot } from "./lib/pixels";

export default async function S8(context: CheckContext) {
  return withBridge(context, async () => {
    const results = [];
    for (const scheme of ["light", "dark"] as const) {
      results.push(await withBrowser(context, async (browser, page) => {
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
        const cursor = (await context.bridge.events()).length;
        const { root, row, entry, ids } = await referenceCut(context, browser, page, "wang");
        const groups = runs(ids);
        const index = groups.reduce((best, group, i) => group.length > groups[best].length ? i : best, 0);
        const marker = root.getByRole("button", { name: /^Show .* removed sentences?$/ }).nth(index);
        const pieces = root.locator("[data-filler-cut-restored]");

        await toggle(page);
        await waitForState(page, "picks-ready");
        const original = await snapshot(root);
        await toggle(page);
        await waitForState(page, "faded");
        await page.evaluate(() => document.fonts.ready);

        const markerPosition = () => marker.evaluate((element) => {
          const { x, y } = element.getBoundingClientRect();
          return { x: x + scrollX, y: y + scrollY };
        });
        const position = await markerPosition();
        const { group, remaining, top } = await expandRun(root, entry, ids, index);
        const noun = group.length === 1 ? "sentence" : "sentences";
        const button = root.getByRole("button", { name: `Hide ${group.length} ${noun}` });
        const drift = Math.abs(await sentenceTop(root, entry.sentences[group[0] - 1]) - top);
        assert.ok(drift <= 3, `Restored text starts ${drift}px from its marker`);
        assert.ok(await button.evaluate((element) => document.activeElement === element), "Focus did not move to the new control");
        await assertMarked(page, entry);
        await page.mouse.move(0, 0);
        const paints = () => pieces.evaluateAll((parts) => {
          const canvas = document.createElement("canvas").getContext("2d")!;
          function alpha(color: string) {
            canvas.clearRect(0, 0, 1, 1);
            canvas.fillStyle = color;
            canvas.fillRect(0, 0, 1, 1);
            return canvas.getImageData(0, 0, 1, 1).data[3];
          }
          return parts.map((part) => {
            const { color, backgroundColor, cursor } = getComputedStyle(part);
            return { color: alpha(color), background: alpha(backgroundColor), cursor };
          });
        });
        const muted = await paints();
        assert.ok(muted.length > 0 && muted.every(({ color, background, cursor }) =>
          Math.abs(color - 255 * .55) <= 1 && background === 0 && cursor === "pointer"), JSON.stringify(muted));

        // Position a kept sentence at the reading anchor before collapsing.
        const first = group[0] - 1;
        const kept = entry.sentences.findLast((_, i) => i < first && !ids.includes(i + 1))
          ?? entry.sentences.find((_, i) => i > first && !ids.includes(i + 1))!;
        await page.evaluate((y) => scrollBy({ top: y, behavior: "instant" }), await sentenceTop(root, kept) - 180);
        const before = await sentenceTop(root, kept);
        assert.ok(Math.abs(before - 180) <= 1, `Could not position the kept sentence (${before}px)`);
        await save(`${context.evidence}/wang-${scheme}-expanded`, (await screenshot(page)).png);

        const point = await button.evaluate((element) => {
          const rect = element.getClientRects()[0];
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        });
        await page.mouse.move(point.x, point.y);
        const hovered = await poll(paints, (parts) => parts.every(({ background }) =>
          Math.abs(background - 255 * .09) <= 1), 1000);
        assert.equal(hovered.length, muted.length);
        await save(`${context.evidence}/wang-${scheme}-hover`, (await screenshot(page)).png);

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

        await page.keyboard.press("Enter");
        await assertCuts(root, entry, remaining);
        assert.ok(await button.evaluate((element) => document.activeElement === element), "Focus did not move to the new control");
        await page.keyboard.down("Shift");
        await waitForState(page, "revealed", 1000);
        assert.equal((await snapshot(root)).html, original.html);
        await page.keyboard.up("Shift");
        await waitForState(page, "faded");
        await assertCuts(root, entry, remaining);
        await button.focus();
        await page.keyboard.press("Enter");
        await assertCuts(root, entry, ids);
        assert.ok(await marker.evaluate((element) => document.activeElement === element), "Focus did not move to the new control");

        await toggle(page);
        await waitForState(page, "picks-ready");
        assert.equal((await snapshot(root)).html, original.html);

        const recuts = async () => (await context.bridge.events()).slice(cursor)
          .filter((event) => event.type === "recut");
        const clicks = await poll(recuts, (events) => events.length >= 2 * group.length, 5000);
        assert.deepEqual(clicks.map(({ sentenceId }) => sentenceId), [...group, ...group]);
        assert.ok(clicks.every((event) => event.cacheKey === row.cacheKey &&
          event.text === entry.sentences[event.sentenceId - 1]));
        return `${scheme}: expanded and collapsed run ${group.join("/")}, ${recutDrift}px kept-sentence drift, ${clicks.length} recut events`;
      }));
    }
    return results.join(" | ");
  });
}
