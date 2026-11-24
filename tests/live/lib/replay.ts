import type { Page } from "playwright";
import { fixture, urls } from "./browser";

export async function replayNavigation(page: Page) {
  const [wang, perfloop] = await Promise.all([fixture("wang"), fixture("perfloop")]);
  await page.evaluate(({ wang, perfloop, urls }) => {
    const main = document.querySelector("main")!;
    const original = new DOMParser().parseFromString(wang, "text/html").querySelector("main")!.innerHTML;
    const other = new DOMParser().parseFromString(perfloop, "text/html").querySelector("main")!.innerHTML;
    const link = document.createElement("a");
    link.href = urls.perfloop;
    link.textContent = "Open Perfloop status";
    document.body.prepend(link);
    function render() {
      main.innerHTML = location.href === urls.wang ? original : other;
      window.scrollTo(0, 0);
    }
    link.addEventListener("click", (event) => {
      event.preventDefault();
      history.pushState(null, "", link.href);
      render();
      link.hidden = true;
    });
    window.addEventListener("popstate", () => {
      render();
      link.hidden = location.href !== urls.wang;
    });
  }, { wang, perfloop, urls });
  return page.getByRole("link", { name: "Open Perfloop status" });
}

export async function detachReplayCell(page: Page) {
  const original = await fixture("wang");
  await page.evaluate((original) => {
    const cell = document.querySelector("[data-testid=cellInnerDiv]")!;
    const parent = cell.parentElement!;
    const html = new DOMParser().parseFromString(original, "text/html").querySelector("main")!.innerHTML;
    cell.remove();
    Object.defineProperty(window, "fillerCutRebuildCell", {
      configurable: true, value: () => parent.insertAdjacentHTML("afterbegin", html),
    });
  }, original);
}

export async function rebuildReplayCell(page: Page, scroll: number) {
  await page.evaluate((y) => {
    (window as unknown as { fillerCutRebuildCell: () => void }).fillerCutRebuildCell();
    window.scrollTo(0, y);
  }, scroll);
}
