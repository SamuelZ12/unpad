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
        const { extract, rangeOf } = await import(source) as typeof import("../../src/content/anchor");
        return (await extract(document, new URL(location.href))).map(({ doc, sentences }) => ({
          surface: doc.surface, sentences: doc.sentences,
          ranges: sentences.map((sentence) => rangeOf(sentence)!.toString().replace(/\s+/gu, " ").trim()),
        }));
      }, module);
      expect(docs.map((doc) => doc.surface)).toEqual([surface]);
      expect(docs[0].ranges).toEqual([...docs[0].sentences]);
      await page.unrouteAll();
    }
  });
}, 15_000);

test("signed-in X finds each post body on timeline and status routes", async () => {
  await withExtraction(async (page, module) => {
    const html = await Bun.file("tests/fixtures/x/x-feed.html").text();
    await page.route("https://x.com/**", (route) => route.fulfill({ contentType: "text/html", body: html }));
    for (const path of ["/home", "/i/lists/1", "/patrickc", "/search?q=chess", "/patrickc/status/2126035198571946229"]) {
      await page.goto("https://x.com" + path);
      const docs = await page.evaluate(async (source) => {
        const { extract } = await import(source) as typeof import("../../src/content/anchor");
        const url = new URL(location.href);
        const preview = document.querySelector("#long [data-testid=tweetText]")!;
        // A preview can reach the sentence threshold before the user expands it.
        preview.textContent = "Six sentences. Still truncated. Three now. And four. Five more. The last.";
        const button = document.querySelector<HTMLButtonElement>("#long button")!;
        button.setAttribute("role", "link");
        const before = await extract(document, url);
        button.click();
        button.hidden = true;
        const wrapper = document.createElement("div");
        wrapper.append(button);
        preview.after(wrapper);
        const quote = document.querySelector<HTMLTemplateElement>("#quoted")!;
        const main = document.querySelector("main")!;
        main.append(quote.content.cloneNode(true));
        document.body.append(preview.cloneNode(true));
        const copy = preview.cloneNode(true) as HTMLElement;
        copy.hidden = true;
        main.querySelector("#long article")!.append(copy);
        const draft = preview.cloneNode(true) as HTMLElement;
        const hidden = document.createElement("span");
        hidden.contentEditable = "true";
        hidden.textContent = "This draft sentence is private.";
        preview.append(hidden);
        main.append(draft);
        const article = document.createElement("div");
        article.dataset.testid = "twitterArticleRichTextView";
        article.innerHTML = `<div data-block="true">${draft.textContent}</div>`;
        main.append(article);
        const after = await extract(document, url);

        const otherPost = document.querySelector("#long article")!.cloneNode(true) as Element;
        otherPost.querySelector("header a")!.setAttribute("href", "/example/status/2");
        main.append(otherPost);
        const duplicate = (await extract(document, url)).at(-1)!.doc;
        return {
          before: before.length, after: after.map(({ doc }) => [doc.surface, doc.sentences.length]),
          sameText: JSON.stringify(duplicate.sentences) === JSON.stringify(after[0].doc.sentences),
          distinctKey: duplicate.key !== after[0].doc.key,
        };
      }, module);
      expect(docs).toEqual({
        before: 0, after: [["x-post", 9], ["x-post", 6]], sameText: true, distinctKey: true,
      });
    }
  });
}, 15_000);

test("X finds the public permalink beside app replies and ignores it on profiles", async () => {
  await withExtraction(async (page, module) => {
    const fixture = await Bun.file("tests/fixtures/x/x-loggedout-wang.html").text();
    const url = "https://x.com/alexandr_wang/status/2124636606959345776";
    const reply = '<article data-testid="tweet"><div data-testid="tweetText">A reply starts here. This is next. And a third. Another one. Then five. That makes six.</div></article>';
    await page.route(url, (route) => route.fulfill({ contentType: "text/html", body: `<!doctype html><main>${fixture}${reply}</main>` }));
    await page.goto(url);
    const result = await page.evaluate(async (source) => {
      const { extract } = await import(source) as typeof import("../../src/content/anchor");
      document.querySelector("main article h1")!.insertAdjacentHTML("beforeend", "<span hidden>Hidden title.</span>");
      document.querySelector("[data-article-body-html]")!.insertAdjacentHTML("beforeend", "<p contenteditable>Private edit.</p>");
      const status = (await extract(document, new URL(location.href))).map(({ doc }) => doc);
      const heading = document.createElement("a");
      heading.href = "/alexandr_wang";
      heading.setAttribute("aria-current", "page");
      document.querySelector("main article")!.prepend(heading);
      const profile = (await extract(document, new URL(heading.href))).map(({ doc }) => doc.surface);
      return { status: status.map((doc) => doc.surface), profile, privateText: JSON.stringify(status).includes("Hidden title.") ||
        JSON.stringify(status).includes("Private edit.") };
    }, module);
    expect(result).toEqual({ status: ["x-post", "x-article"], profile: ["x-post"], privateText: false });
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
      const { extract, rangeOf } = await import(source) as typeof import("../../src/content/anchor");
      return (await extract(document, new URL(location.href))).map(({ doc, sentences }) => ({
        surface: doc.surface, title: doc.title, sentences: doc.sentences,
        ranges: sentences.map((sentence) => rangeOf(sentence)!.toString().replace(/\s+/gu, " ").trim()),
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

test("whole removed paragraphs share one marker and leave their source nodes in place", async () => {
  const build = await Bun.build({ entrypoints: ["src/content/reconcile.ts"], target: "browser", define: { "process.env.BRIDGE_URL": '""' } });
  const projectionModule = "data:text/javascript," + encodeURIComponent(await build.outputs[0].text());
  await withExtraction(async (page, module) => {
    await page.route("https://example.com/article", (route) => route.fulfill({
      contentType: "text/html", body: "<!doctype html><main></main>",
    }));
    await page.goto("https://example.com/article");
    const results = await page.evaluate(async ({ module, projectionModule }) => {
      const { extract } = await import(module) as typeof import("../../src/content/anchor");
      const { createProjection } = await import(projectionModule) as typeof import("../../src/content/reconcile");
      const paragraphs = [
        "Visible opening sentence.",
        "A hidden paragraph starts here. More filler follows here.",
        "Another filler paragraph here.",
        "Visible closing sentence. Another line stays here. The final words stay here.",
      ];
      const main = document.querySelector("main")!;
      const readings = [];
      for (const html of [
        paragraphs.map((text) => '<p>' + text + '</p>').join(""),
        "<font>" + paragraphs.join("<br><br>") + "</font>",
      ]) {
        main.innerHTML = html;
        const projection = createProjection(() => {});
        const [anchored] = await extract(document, new URL(location.href));
        const text = anchored.sentences[3].slices[0].node;
        const parent = text.parentNode!;
        const visible = anchored.doc.sentences.filter((_, i) => [0, 4, 5, 6].includes(i)).join(" ");
        const docState = {
          doc: anchored.doc, restored: new Set(), unmarked: new Set(),
          picks: { kind: "ready", cacheKey: "cache", selection: { kind: "keep", keep: [1, 5, 6, 7] }, key: [1, 5] },
        } as unknown as import("../../src/core/state").DocState;
        const state = { lensOn: true, holding: false, docs: new Map([[anchored.doc.key, docState]]) };
        projection.reconcile([anchored], state);
        const [rebuilt] = await extract(document, new URL(location.href), false, projection.read);
        const marker = main.querySelector("[data-filler-cut-marker]");
        const cutContent = main.innerText.replace("···", "").replace(/\s+/gu, " ").trim();
        const children = [...main.querySelectorAll("p, br")].filter((node) => node.getClientRects().length > 0);
        projection.reconcile([rebuilt], state);

        readings.push({
          visible: cutContent === visible,
          count: main.querySelectorAll("[data-filler-cut-marker]").length,
          stable: main.querySelector("[data-filler-cut-marker]") === marker && rebuilt.doc.key === anchored.doc.key,
          surviving: children.length,
          sameParent: text.parentNode === parent,
        });

        // A framework can replace its text child while the cut is active.
        const next = document.createTextNode(paragraphs[2]);
        parent.insertBefore(next, text);
        parent.removeChild(text);
        const docs = await extract(document, new URL(location.href), false, projection.read);
        projection.reconcile(docs, { ...state, lensOn: false });
        readings.push({ exactOriginal: main.innerHTML === html, replacement: next.parentNode === parent });
      }
      return readings;
    }, { module, projectionModule });
    expect(results).toEqual([
      { visible: true, count: 1, stable: true, surviving: 3, sameParent: true },
      { exactOriginal: true, replacement: true },
      { visible: true, count: 1, stable: true, surviving: 4, sameParent: true },
      { exactOriginal: true, replacement: true },
    ]);
  });
}, 15_000);
