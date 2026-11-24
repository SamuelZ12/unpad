import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { chromium, type Page } from "playwright";

async function withExtraction(run: (page: Page, module: string) => Promise<void>) {
  const build = await Bun.build({ entrypoints: ["src/content/anchor.ts"], target: "browser", define: { "process.env.BRIDGE_URL": "\"\"" } });
  expect(build.success).toBe(true);
  const module = "data:text/javascript," + encodeURIComponent(await build.outputs[0].text());
  const profile = await mkdtemp("/tmp/filler-chrome-anchor-");
  try {
    const browser = await chromium.launchPersistentContext(profile, { channel: "chromium" });
    try {
      await run(browser.pages()[0], module);
    } finally {
      await browser.close();
    }
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
}

test("every captured document has ranges matching its sentences", async () => {
  await withExtraction(async (page, module) => {
    const cases = [
      ["x/x-loggedin-article-wang.html", "https://x.com/alexandr_wang/status/2124636606959345776", "x-article"],
      ["x/x-loggedout-wang.html", "https://x.com/alexandr_wang/status/2124636606959345776", "x-article"],
      ["x/x-loggedin-post-perfloop.html", "https://x.com/tsenart/status/2123483102936785334", "x-post"],
      ["x/x-loggedout-perfloop.html", "https://x.com/tsenart/status/2123483102936785334", "x-post"],
      ["blog/warp.html", "https://claude.com/resources/articles/how-warp-builds-self-improving-agents-on-claude", "blog"],
    ] as const;
    for (const [file, url, surface] of cases) {
      const html = '<!doctype html><main>' + await Bun.file("tests/fixtures/" + file).text() + "</main>";
      await page.route("**/*", (route) => route.request().isNavigationRequest()
        ? route.fulfill({ contentType: "text/html", body: html })
        : route.abort());
      await page.goto(url);
      const docs = await page.evaluate(async (source) => {
        const { extract } = await import(source) as typeof import("../../src/content/anchor");
        return (await extract(document, new URL(location.href))).map(({ doc, ranges }) => ({
          surface: doc.surface, sentences: doc.sentences,
          ranges: ranges.map((range) => range.toString().replace(/\s+/gu, " ").trim()),
        }));
      }, module);
      expect(docs.map((doc) => doc.surface)).toEqual([surface]);
      expect(docs[0].ranges).toEqual([...docs[0].sentences]);
      await page.unrouteAll();
    }
  });
}, 15_000);

test("generic site mode needs five non-list blocks of at least 40 words", async () => {
  await withExtraction(async (page, module) => {
    await page.route("https://example.com/article", (route) => route.fulfill({
      contentType: "text/html", body: "<!doctype html><main></main>",
    }));
    await page.goto("https://example.com/article");
    const docs = (html: string, checkArticle = true) => page.evaluate(async ({ module, html, checkArticle }) => {
      const { extract } = await import(module) as typeof import("../../src/content/anchor");
      document.querySelector("main")!.innerHTML = html;
      return (await extract(document, new URL(location.href), checkArticle)).length;
    }, { module, html, checkArticle });

    const sentence = "A useful sentence with enough words to exercise the paragraph rule.".split(" ");
    const text = (words: number) => [19, words - 19].map((count) =>
      Array.from({ length: count }, (_, i) => sentence[i % sentence.length].replace(".", "")).join(" ") + ".").join(" ");
    const paragraph = `<p>${text(40)}</p>`;
    const four = paragraph.repeat(4);
    expect(await docs(four + paragraph)).toBe(1);
    expect(await docs(four)).toBe(0);
    expect(await docs(four + `<p>${text(39)} <span hidden>extra</span></p>`)).toBe(0);
    expect(await docs(four + `<p>${text(39)} <span aria-hidden="true">extra</span></p>`)).toBe(0);
    expect(await docs(four + `<div contenteditable="true">${paragraph}</div>`)).toBe(0);
    expect(await docs(four + `<ul><li>${paragraph}</li></ul>`)).toBe(0);
    expect(await docs(four, false)).toBe(1);
  });
}, 15_000);

test("a page of bare text split by <br> yields one document of whole sentences", async () => {
  await withExtraction(async (page, module) => {
    const html = await Bun.file("tests/fixtures/blog/paulgraham-jessica.html").text();
    await page.route("**/*", (route) => route.request().isNavigationRequest()
      ? route.fulfill({ contentType: "text/html", body: html })
      : route.abort());
    await page.goto("https://paulgraham.com/jessica.html");
    const docs = await page.evaluate(async (source) => {
      const { extract } = await import(source) as typeof import("../../src/content/anchor");
      return (await extract(document, new URL(location.href))).map(({ doc, ranges }) => ({
        surface: doc.surface, title: doc.title, sentences: doc.sentences,
        ranges: ranges.map((range) => range.toString().replace(/\s+/gu, " ").trim()),
      }));
    }, module);
    expect(docs.map(({ surface, title }) => [surface, title])).toEqual([["blog", "Jessica Livingston"]]);
    expect(docs[0].ranges).toEqual([...docs[0].sentences]);
    // The first sentence spans a source newline. The second ends at a <br>.
    expect(docs[0].sentences).toContain('A few months ago an article about Y Combinator said that early on it had been a "one-man show."');
    expect(docs[0].sentences).toContain("So let me tell you a little about Jessica.");
    expect(docs[0].sentences).toContain("YC had 4 founders.");
  });
}, 15_000);
