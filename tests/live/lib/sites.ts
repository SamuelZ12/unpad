import assert from "node:assert/strict";
import type { Page, Worker } from "playwright";
import { state } from "./browser";

export const articleUrl = "https://www.anthropic.com/research/building-effective-agents";

export async function openSite(page: Page, url: string) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const response = await page.goto(url, { waitUntil: "domcontentloaded" });
  assert.ok(response?.ok(), `HTTP ${response?.status()} from ${page.url()}`);
  await page.evaluate(() => document.fonts.ready);
}

export async function assertUninjected(page: Page) {
  assert.deepEqual(await state(page), { view: undefined, faded: NaN });
  assert.equal(await page.evaluate(() => CSS.highlights.has("filler-cut")), false);
  assert.equal(await page.evaluate(() => CSS.highlights.has("filler-cut-key")), false);
}

export function grants(worker: Worker) {
  return worker.evaluate(async () => {
    const { origins = [] } = await chrome.permissions.getAll();
    return origins.sort();
  });
}

export function registrations(worker: Worker) {
  return worker.evaluate(async () =>
    (await chrome.scripting.getRegisteredContentScripts()).flatMap(({ matches }) => matches ?? []).sort());
}

export function activeBadge(worker: Worker) {
  return worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return chrome.action.getBadgeText({ tabId: tab.id });
  });
}
