import assert from "node:assert/strict";
import type { Locator, Page } from "playwright";
import { collapse } from "../../../src/core/segment";
import type { SelectRequest, SelectResponse } from "../../../src/shared/wire";
import type { CheckContext } from "../run";
import type { Reference } from "./browser";
import { atMost, trace, waitForState, withBrowser } from "./check";

const marker = "[data-filler-cut-marker]";
type Browser = Parameters<Parameters<typeof withBrowser>[1]>[0];

export async function cacheEntry(context: CheckContext, cacheKey: string | null) {
  assert.ok(cacheKey, "Bridge did not log a cache key");
  return Bun.file(`${context.bridge.data}/cache/${cacheKey}.json`).json() as Promise<Omit<SelectRequest, "key"> & SelectResponse>;
}

export function pickedCuts(entry: Awaited<ReturnType<typeof cacheEntry>>) {
  const selection = entry.selection;
  return selection.kind === "keep" ? entry.sentences.flatMap((_, i) =>
    selection.keep.some((id) => id === i + 1) ? [] : [i + 1]) : [];
}

export function runs(ids: readonly number[]) {
  return ids.reduce<number[][]>((groups, id) => {
    const previous = groups.at(-1);
    if (previous?.at(-1) === id - 1) previous.push(id);
    else groups.push([id]);
    return groups;
  }, []);
}

export async function assertCuts(root: Locator, entry: Awaited<ReturnType<typeof cacheEntry>>, ids = pickedCuts(entry)) {
  const body = collapse((await root.innerText()).replaceAll("···", ""));
  for (const [i, sentence] of entry.sentences.entries()) {
    // The same words can occur in a second sentence or in an unselected heading.
    if (ids.includes(i + 1)) {
      if (entry.sentences.some((other, j) => !ids.includes(j + 1) && other.includes(sentence))) continue;
      assert.ok(!body.includes(sentence), `Removed sentence ${i + 1} is still visible: ${sentence}`);
    } else {
      assert.ok(body.includes(sentence), `Kept sentence ${i + 1} is missing: ${sentence}`);
    }
  }
  const markers = root.locator(marker);
  const titles = await markers.evaluateAll((nodes) => nodes.map((node) => ({
    title: (node as HTMLElement).title, label: node.textContent, width: node.getBoundingClientRect().width,
  })));
  const groups = runs(ids);
  assert.deepEqual(titles.map(({ title }) => title), groups.map(({ length }) =>
    `Show ${length} removed ${length === 1 ? "sentence" : "sentences"}`));
  assert.ok(titles.every(({ label, width }) => label === "···" && width > 0), "A marker takes no space or has the wrong label");
}

export function snapshot(root: Locator) {
  return root.evaluate((element: HTMLElement) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return { text: element.innerText, html: element.outerHTML, height: range.getBoundingClientRect().height };
  });
}

export async function referenceCut(context: CheckContext, browser: Browser, page: Page, name: Reference) {
  const index = (await context.bridge.requests()).length;
  const root = await browser.open(page, name);
  const row = await context.bridge.waitForRequest(index);
  const entry = await cacheEntry(context, row.cacheKey);
  const ids = pickedCuts(entry);
  assert.ok(ids.length, `${name} has no cuts (${row.result})`);
  assert.equal((await waitForState(page, "faded")).faded, ids.length);
  await assertCuts(root, entry);
  return { root, row, entry, ids };
}

export async function coldCut(context: CheckContext, browser: Browser, page: Page, name: Reference) {
  const result = await referenceCut(context, browser, page, name);
  assert.equal(result.row.source, "pi");
  const first = (await trace(page)).find(({ view }) => view === "faded")!;
  const elapsed = first.at - (Date.parse(result.row.time) + result.row.ms);
  atMost(elapsed, 1000, `${name} bridge response to cut`);
  return { ...result, elapsed };
}

export async function expandRun(
  root: Locator, entry: Awaited<ReturnType<typeof cacheEntry>>, ids = pickedCuts(entry), index = 0,
) {
  const group = runs(ids)[index];
  assert.ok(group, "No run to expand");
  const button = root.locator(marker).nth(index);
  await button.evaluate((element) => element.scrollIntoView({ block: "center", behavior: "instant" }));
  const point = await button.boundingBox();
  assert.ok(point);
  await button.click({ timeout: 5000 });
  const remaining = ids.filter((id) => !group.includes(id));
  await assertCuts(root, entry, remaining);
  return { group, remaining, top: point.y };
}

export function captureDomErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return async (path: string) => {
    await Bun.write(path, JSON.stringify(errors, null, 2));
    assert.deepEqual(errors.filter((error) =>
      /removeChild|insertBefore|not a child of this node|NotFoundError|Minified React error #(?:132|185|418|423)/i.test(error)), []);
  };
}

export async function withBridge<T>(context: CheckContext, run: () => Promise<T>) {
  await context.bridge.start();
  try { return await run(); } finally { await context.bridge.stop(); }
}

export function sentenceTop(root: Locator, sentence: string) {
  return root.evaluate((element, sentence) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const initial = sentence.slice(0, 12);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!(node instanceof Text)) continue;
      const match = [...node.data.matchAll(/[\s\S]/gu)].find(({ index }) =>
        node.data.slice(index).replace(/\s+/gu, " ").startsWith(initial));
      if (!match) continue;
      const range = document.createRange();
      range.setStart(node, match.index);
      range.setEnd(node, match.index + match[0].length);
      const rect = range.getClientRects()[0];
      if (rect?.width) return rect.top;
    }
    throw new Error("Cannot locate start of " + sentence);
  }, sentence);
}

export function proseHtml(root: Locator) {
  return root.locator("p").evaluateAll((paragraphs) => paragraphs
    .filter((paragraph) => !paragraph.closest("nav, header, footer, aside, form, figure, table"))
    .map((paragraph) => paragraph.outerHTML));
}
