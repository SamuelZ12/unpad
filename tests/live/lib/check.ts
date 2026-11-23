import assert from "node:assert/strict";
import type { Page } from "playwright";
import type { CheckContext } from "../run";
import type { View } from "../../../src/core/state";
import { launch, state } from "./browser";
import { poll } from "./pixels";

export async function withBrowser<T>(context: CheckContext, work: (
  browser: Awaited<ReturnType<typeof launch>>, page: Page,
) => Promise<T>) {
  const browser = await launch(context.mode);
  try {
    const page = browser.context.pages()[0];
    await browser.context.addInitScript(() => {
      const trace: { view: string; at: number }[] = [];
      Object.defineProperty(window, "fillerCutTrace", { value: trace });
      new MutationObserver(() => {
        const view = document.documentElement?.dataset.fillerCutState;
        if (view && view !== trace.at(-1)?.view) trace.push({ view, at: Date.now() });
      }).observe(document, { attributes: true, subtree: true, attributeFilter: ["data-filler-cut-state"] });
    });
    return await work(browser, page);
  } finally {
    await browser.close();
  }
}

export async function trace(page: Page) {
  return page.evaluate(() => (window as unknown as { fillerCutTrace: { view: View; at: number }[] }).fillerCutTrace);
}

export async function waitForState(page: Page, expected: View, timeout = 45_000) {
  return poll(() => state(page), (value) => value.view === expected, timeout);
}

export function toggle(page: Page) {
  return page.keyboard.press("Alt+Shift+KeyF");
}

export function atMost(actual: number, max: number, label: string) {
  assert.ok(actual <= max, `${label}: ${actual.toFixed(1)} ms > ${max} ms`);
}
