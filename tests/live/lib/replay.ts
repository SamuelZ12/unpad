import type { Page } from "playwright";
import { fixture, urls } from "./browser";

export async function replayNavigation(page: Page) {
  const perfloop = await fixture("perfloop");
  await page.evaluate(({ perfloop, urls }) => {
    const main = document.querySelector("main")!;
    const wang = main.innerHTML;
    const other = new DOMParser().parseFromString(perfloop, "text/html").querySelector("main")!.innerHTML;
    const link = document.createElement("a");
    link.href = urls.perfloop;
    link.textContent = "Open Perfloop status";
    document.body.prepend(link);
    function render() {
      main.innerHTML = location.href === urls.wang ? wang : other;
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
  }, { perfloop, urls });
  return page.getByRole("link", { name: "Open Perfloop status" });
}

export async function detachReplayCell(page: Page) {
  await page.evaluate(() => {
    const cell = document.querySelector("[data-testid=cellInnerDiv]")!;
    const parent = cell.parentElement!;
    const html = cell.outerHTML;
    cell.remove();
    Object.defineProperty(window, "fillerCutRebuildCell", {
      configurable: true, value: () => parent.insertAdjacentHTML("afterbegin", html),
    });
  });
}

export async function rebuildReplayCell(page: Page, scroll: number) {
  await page.evaluate((y) => {
    (window as unknown as { fillerCutRebuildCell: () => void }).fillerCutRebuildCell();
    window.scrollTo(0, y);
  }, scroll);
}
