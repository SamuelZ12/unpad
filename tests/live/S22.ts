import assert from "node:assert/strict";
import { cacheKeyFor, writeCache } from "../../bridge/cache";
import { collapse, segment } from "../../src/core/segment";
import type { SentenceId } from "../../src/shared/types";
import type { CheckContext } from "./run";
import { extensionWorker } from "./lib/action";
import { xHomeUrl } from "./lib/browser";
import { toggle, waitForState, withBrowser } from "./lib/check";
import { assertCuts, captureDomErrors, expandRun, withBridge } from "./lib/cut";
import { poll } from "./lib/pixels";
import { watchSelections } from "./lib/extension";
import { activeBadge } from "./lib/sites";

const body = "[data-testid=tweetText]";
const marker = "[data-filler-cut-marker]";
const restored = "[data-filler-cut-restored]";

export default async function S22(context: CheckContext) {
  const { bridge, evidence } = context;
  return withBridge(context, () => withBrowser(context, async (browser, page) => {
    const checkConsole = captureDomErrors(page);
    page.setDefaultTimeout(5000);
    try {
      const worker = await extensionWorker(browser.context);
      const selects = await watchSelections(worker);
      const badge = (text: string) => poll(() => activeBadge(worker), (value) => value === text, 3000);
      const before = (await bridge.requests()).length;
      const requests = async (count: number) => {
        assert.equal(await selects(), count, "Selection messages");
        assert.equal((await bridge.requests()).length - before, count, "Bridge requests");
      };

      const fixture = await Bun.file("tests/fixtures/x/x-feed.html").text();
      await page.route(xHomeUrl, (route) => route.fulfill({ contentType: "text/html", body: fixture }));
      await page.goto(xHomeUrl);
      await page.locator("html[data-filler-cut-debug]").waitFor();
      const long = page.locator("#long");
      const post = long.locator(body);
      const short = page.locator("#short");
      const [preview, shortHtml] = await page.evaluate((html) => {
        const original = new DOMParser().parseFromString(html, "text/html");
        return ["#long", "#short"].map((selector) => original.querySelector(selector)!.innerHTML);
      }, fixture);
      const [expanded, quoted] = await page.locator("template").evaluateAll((templates) =>
        (templates as HTMLTemplateElement[]).map(({ content }) => content.querySelector("[role=link] [data-testid=tweetText]")?.textContent ?? content.textContent!));

      const { versions } = bridge;
      async function seed(text: string, count: number, removed: number[]) {
        const sentences = segment(text).map((span) => span.text);
        assert.equal(sentences.length, count);
        const doc = { title: "", sentences };
        const cacheKey = await cacheKeyFor(doc, versions);
        const keep = sentences.flatMap((_, i) => removed.includes(i + 1) ? [] : [(i + 1) as SentenceId]);
        const entry = { ...doc, ...versions, cacheKey, selection: { kind: "keep", keep } as const, raw: "", ms: 0 };
        await writeCache(bridge.data, entry);
        return entry;
      }
      const postPicks = await seed(expanded, 9, [3, 4, 6]);
      const quotePicks = await seed(quoted, 6, [2, 3, 4]);

      await badge("");
      await requests(0);
      assert.equal(await long.innerHTML(), preview);
      assert.equal(await short.innerHTML(), shortHtml);
      const original = await post.elementHandle();
      assert.ok(original);
      await long.getByRole("button", { name: "Show more" }).click();
      assert.equal(await original.evaluate((node) => node === document.querySelector("#long [data-testid=tweetText]")), true);
      await waitForState(page, "faded", 5000);
      await assertCuts(post, postPicks);
      await badge("3");
      await requests(1);

      const { remaining } = await expandRun(post, postPicks);
      assert.deepEqual(await page.evaluate("postOpens"), []);
      await post.locator(restored).first().click();
      await assertCuts(post, postPicks);
      assert.deepEqual(await page.evaluate("postOpens"), []);
      await expandRun(post, postPicks);
      await badge("1");
      await long.evaluate((node) => node.remove());
      await waitForState(page, "idle", 3000);
      await badge("");
      await page.evaluate("rebuildLong()");
      await waitForState(page, "faded", 3000);
      await assertCuts(post, postPicks, remaining);
      await badge("1");
      await post.locator(restored).first().click();
      await assertCuts(post, postPicks);
      await badge("3");
      await expandRun(post, postPicks);
      await requests(1);
      const cutText = collapse(await post.innerText());

      // X can replace or set its original Text child while our sibling spans are present.
      const source = await post.evaluateHandle((node) => node.querySelector("a + span")!.firstChild as Text);
      const originalText = await page.locator("#expanded").evaluate((template: HTMLTemplateElement) =>
        template.content.querySelector("a + span")!.firstChild!.textContent!);
      const replacement = await source.evaluateHandle((node, text) => {
        if (node.data !== "") throw new Error("Expected a projected source node");
        const next = document.createTextNode(text);
        node.parentNode!.replaceChild(next, node);
        return next;
      }, originalText);
      await page.waitForFunction((node) => node.data === "", replacement);
      await assertCuts(post, postPicks, remaining);
      assert.equal(collapse(await post.innerText()), cutText);
      await replacement.evaluate((node, text) => { node.data = text + " "; }, originalText);
      await page.waitForFunction((node) => node.data === "", replacement);
      await assertCuts(post, postPicks, remaining);
      assert.equal(collapse(await post.innerText()), cutText);
      await requests(1);

      await toggle(page);
      await waitForState(page, "picks-ready");
      assert.equal(await replacement.evaluate((node) => node.data), originalText + " ");
      await replacement.evaluate((node, text) => { node.data = text; }, originalText);
      assert.equal(await post.innerHTML(), await page.locator("#expanded").innerHTML());
      assert.equal(await short.innerHTML(), shortHtml);
      await toggle(page);
      await waitForState(page, "faded", 3000);
      await assertCuts(post, postPicks, remaining);

      await post.locator(marker).focus();
      await page.evaluate("mountQuote()");
      const host = page.locator("#quote").locator(body).first();
      const quote = page.locator("#quote [role=link]").locator(body);
      await quote.locator(marker).waitFor();
      await assertCuts(quote, quotePicks);
      assert.doesNotMatch(await quote.innerText(), /\n{3,}/, "Removed quote paragraphs left blank lines");
      await badge("4");
      await requests(2);
      assert.ok(await post.locator(marker).evaluate((node) => node === document.activeElement));
      const hostHtml = await page.locator("#quoted").evaluate((template: HTMLTemplateElement) =>
        template.content.querySelector("[data-testid=tweetText]")!.innerHTML);
      assert.equal(await host.innerHTML(), hostHtml);
      await quote.locator(marker).click();
      await assertCuts(quote, quotePicks, []);
      await assertCuts(post, postPicks, remaining);
      await badge("1");
      await quote.locator(restored).first().click();
      await assertCuts(quote, quotePicks);
      await assertCuts(post, postPicks, remaining);
      await badge("4");
      assert.deepEqual(await page.evaluate("postOpens"), []);

      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        await page.screenshot({ path: `${evidence}/feed-${colorScheme}.png` });
      }

      for (const label of ["Like", "Reply"]) {
        const button = long.getByRole("button", { name: label });
        await button.click();
        assert.equal(await button.getAttribute("aria-pressed"), "true");
      }
      const statusUrl = await long.locator("header a").evaluate((anchor: HTMLAnchorElement) => anchor.href);
      await browser.context.route(statusUrl, (route) => route.fulfill({ contentType: "text/html", body: "<main></main>" }));
      const [opened] = await Promise.all([
        page.waitForEvent("popup"),
        post.getByText("Thanksgiving morning project", { exact: false }).click(),
      ]);
      await opened.waitForURL(statusUrl);
      assert.deepEqual(await page.evaluate("postOpens"), [statusUrl]);
      await opened.close();
      await requests(2);

      const link = post.locator('a[href^="https://"]');
      const href = await page.locator("#expanded").evaluate((template: HTMLTemplateElement) =>
        new URL(template.content.querySelector("a")!.getAttribute("href")!, location.href).href);
      await page.route(href, (route) => route.fulfill({ contentType: "text/html", body: "Methodology" }));
      await Promise.all([page.waitForURL(href), link.click()]);
      return "0 selects for the preview and short post, 1 on expansion, 0 on cell rebuild or same-content updates, 1 for the quoted body; cuts, expanded text, badge, exact restoration, and post actions verified";
    } finally {
      await checkConsole(evidence + "/console.json");
    }
  }));
}
