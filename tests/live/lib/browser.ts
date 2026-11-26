import { mkdtemp, realpath, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { preapproveHost, extensionId, requestHostFromOptions } from "./extension";
import { chromium, type Page, type ViewportSize } from "playwright";

export const xHomeUrl = "https://x.com/home";

export const urls = {
  wang: "https://x.com/alexandr_wang/status/2124636606959345776",
  perfloop: "https://x.com/tsenart/status/2123483102936785334",
  warp: "https://claude.com/blog/how-warp-builds-self-improving-agents-on-claude",
};
export type Reference = keyof typeof urls;
export type Mode = "logged-out" | "replay" | "logged-in";
export const roots = {
  wang: "main [data-article-body-html], [data-testid=twitterArticleRichTextView]",
  perfloop: "main article div[dir=auto][lang], [data-testid=tweetText]",
  warp: "article .text-rich-text--article",
};
let lastLoggedInLoad = 0;
const fixtures = {
  wang: "x-loggedin-article-wang.html",
  perfloop: "x-loggedin-post-perfloop.html",
};

export async function fixture(name: Exclude<Reference, "warp">) {
  const article = await Bun.file("tests/fixtures/x/" + fixtures[name]).text();
  return `<!doctype html><meta charset=utf-8><style>
    body { font: 17px/1.5 system-ui; margin: 24px auto; width: 620px; color: #e7e9ea; background: #000 }
    img, svg, video, button { display: none } [data-block] { margin: 12px 0 }
    [data-testid=tweetText] { white-space: pre-wrap }
    [data-testid=twitter-article-title] { font-size: 28px; font-weight: bold }
  </style><main><div data-testid=cellInnerDiv>${article}</div></main>`;
}

export async function launch(
  mode: Mode, headless = true, videoDir?: string,
  options: { actionProfile?: string; extension?: string; viewport?: ViewportSize } = {},
) {
  const { actionProfile, extension = resolve("dist/extension"), viewport = { width: 1280, height: 900 } } = options;
  const temporary = mode !== "logged-in";
  if (actionProfile && !temporary) throw new Error("Browser action checks require an isolated profile");
  const signedIn = process.env.FILLER_CUT_X_TEST_PROFILE;
  let profile: string;
  if (temporary) {
    profile = actionProfile ?? await mkdtemp("/tmp/filler-chrome-");
  } else {
    if (!signedIn || !(await realpath(signedIn)).startsWith((await realpath("/tmp")) + "/")) {
      throw new Error("Set FILLER_CUT_X_TEST_PROFILE to an isolated Chrome profile under /tmp");
    }
    profile = signedIn;
  }
  const cleanup = async () => {
    if (temporary && !actionProfile) await rm(profile, { recursive: true, force: true });
  };
  try {
    const context = await chromium.launchPersistentContext(profile, {
      channel: "chromium", headless, viewport,
      recordVideo: videoDir ? { dir: videoDir, size: viewport } : undefined,
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/159.0.0.0 Safari/537.36",
      args: [
        `--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
        ...actionProfile ? ["--remote-debugging-port=0", "--enable-unsafe-extension-debugging"] : [],
      ],
    });
    if (mode === "replay") {
      await context.route("https://x.com/**", async (route) => {
        if (route.request().resourceType() !== "document") return route.abort();
        const url = route.request().url();
        const name = url === urls.wang ? "wang" : "perfloop";
        const body = new URL(url).pathname === "/home" ? "<!doctype html><main><h1>Home</h1></main>" : await fixture(name);
        await route.fulfill({ contentType: "text/html", body });
      });
    }
    let addedWarp = false;
    let warpEnabled: Promise<void> | undefined;
    async function addWarpSite() {
      const match = "https://claude.com:443/*";
      await preapproveHost(context, match);
      const settings = await context.newPage();
      try {
        await settings.goto(`chrome-extension://${await extensionId(context)}/options.html`);
        const { present, lensOn } = await settings.evaluate(async (origin) => ({
          present: (await chrome.permissions.getAll()).origins?.includes(origin) ?? false,
          lensOn: (await chrome.storage.local.get("lensOn")).lensOn as boolean | undefined,
        }), match);
        if (!present) {
          await requestHostFromOptions(settings, match);
          addedWarp = true;
        }
        await settings.waitForFunction(async (id) =>
          (await chrome.scripting.getRegisteredContentScripts({ ids: [id] })).length > 0, match);
        await settings.evaluate(async (lensOn) => {
          if (lensOn === undefined) await chrome.storage.local.remove("lensOn");
          else await chrome.storage.local.set({ lensOn });
        }, lensOn);
      } finally {
        await settings.close();
      }
    }
    async function open(page: Page, name: Reference) {
      if (name === "warp") await (warpEnabled ??= addWarpSite());
      if (!temporary) await Bun.sleep(Math.max(0, lastLoggedInLoad + 3000 - Date.now()));
      const response = await page.goto(urls[name], { waitUntil: "domcontentloaded" }).finally(() => {
        if (!temporary) lastLoggedInLoad = Date.now();
      });
      const root = page.locator(roots[name]).first();
      try {
        await root.waitFor({ state: "visible", timeout: 15_000 });
      } catch {
        throw new Error(`${name}: HTTP ${response?.status()} at ${page.url()}, missing doc: ${(await page.locator("body").innerText()).slice(0, 240)}`);
      }
      if (!temporary && name !== "warp") {
        const signedIn = await page.evaluate(() => ({
          app: !!document.querySelector("[data-testid=primaryColumn]"),
          account: !!document.querySelector("[data-testid=SideNav_AccountSwitcher_Button]"),
          publicPage: !!document.querySelector("[data-article-body-html], a[href='/login']"),
        }));
        if (!signedIn.app || !signedIn.account) {
          throw new Error(`X test profile did not open the signed-in app (app=${signedIn.app}, account=${signedIn.account}, public frontend=${signedIn.publicPage})`);
        }
      }
      return root;
    }
    return { context, open, close: async () => {
      try {
        if (!temporary && addedWarp) {
          const settings = await context.newPage();
          await settings.goto(`chrome-extension://${await extensionId(context)}/options.html`);
          await settings.evaluate(() => chrome.permissions.remove({ origins: ["https://claude.com:443/*"] }));
          await settings.close();
        }
      } finally {
        try { await context.close(); } finally { await cleanup(); }
      }
    } };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export async function state(page: Page) {
  return page.locator("html").evaluate((html) => ({
    view: html.dataset.fillerCutState,
    faded: Number(html.dataset.fillerCutFaded),
  }));
}
