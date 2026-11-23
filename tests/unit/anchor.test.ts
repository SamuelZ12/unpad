import { expect, test } from "bun:test";
import { chromium } from "playwright";

test("every captured document has ranges matching its sentences", async () => {
  const build = await Bun.build({ entrypoints: ["src/content/anchor.ts"], target: "browser", define: { "process.env.BRIDGE_URL": "\"\"" } });
  expect(build.success).toBe(true);
  const module = await build.outputs[0].text();
  const browser = await chromium.launch({ channel: "chromium" });
  try {
    const page = await browser.newPage();
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
        const { extract } = await import("data:text/javascript," + encodeURIComponent(source)) as typeof import("../../src/content/anchor");
        return (await extract(document, new URL(location.href))).map(({ doc, ranges }) => ({
          surface: doc.surface, sentences: doc.sentences,
          ranges: ranges.map((range) => range.toString().replace(/\s+/gu, " ").trim()),
        }));
      }, module);
      expect(docs.map((doc) => doc.surface)).toEqual([surface]);
      expect(docs[0].ranges).toEqual([...docs[0].sentences]);
      await page.unrouteAll();
    }
  } finally {
    await browser.close();
  }
}, 15_000);
