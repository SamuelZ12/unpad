import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { BrowserContext, Page } from "playwright";
import { DEMO_ARTICLE, hostPermission, issue } from "../../src/shared/connection";
import { providers } from "../../src/background/providers";
import { extensionId, extensionWorker, preapproveHost, withActionBrowser } from "./lib/action";
import { xHomeUrl } from "./lib/browser";
import { requestHostFromOptions } from "./lib/extension";
import { toggle, waitForState } from "./lib/check";
import { apiKey, chatGPTToken } from "./lib/credentials";
import { poll } from "./lib/pixels";

const ids = ["fresh", "oauth", "anthropic", "gemini", "chatgpt"] as const;
const args = Bun.argv.slice(2);
if (!args.length || args.some((id) => !ids.some((allowed) => allowed === id))) {
  throw new Error("Usage: bun run verify:setup fresh oauth anthropic gemini chatgpt");
}
const evidence = join(homedir(), ".pi/agent/filler-cut/evidence", "setup-" + new Date().toISOString().replaceAll(":", "-") + "-" + args.join("-"));
await mkdir(evidence, { recursive: true });
console.log(`Evidence: ${evidence}`);

async function build(outdir: string, auth = "", unassign = false) {
  const output = Bun.spawn([process.execPath, "scripts/build.ts"], {
    env: { ...process.env, BRIDGE_URL: "", FILLER_CUT_OUTDIR: outdir, FILLER_CUT_DEV: "1", FILLER_CUT_AUTH_ORIGIN: auth },
    stdout: "ignore", stderr: "inherit",
  });
  assert.equal(await output.exited, 0, "Build failed");
  if (unassign) {
    const file = join(outdir, "manifest.json");
    const manifest = await Bun.file(file).json();
    delete manifest.commands["toggle-lens"].suggested_key;
    await Bun.write(file, JSON.stringify(manifest));
  }
}

async function welcome(context: BrowserContext) {
  const address = `chrome-extension://${await extensionId(context)}/options.html`;
  const page = await poll(async () => context.pages().find((tab) => tab.url() === address), Boolean, 5000);
  assert.ok(page, "Fresh install did not open setup");
  await page.getByRole("heading", { name: "Connect" }).waitFor({ timeout: 5000 });
  assert.equal(await page.getByRole("button", { name: "Continue with ChatGPT" }).isVisible(), true);
  return page;
}

async function captures(page: Page, name: string, popup = false) {
  if (!popup) await page.setViewportSize({ width: 760, height: 710 });
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    const path = join(evidence, `${name}-${colorScheme}.png`);
    if (popup) await page.locator("body").screenshot({ path });
    else await page.screenshot({ path, fullPage: true });
  }
}

async function openArticle(page: Page, url: string) {
  const response = await page.goto(url, { waitUntil: "domcontentloaded" });
  assert.ok(response?.ok(), "Article did not load");
}

async function cutArticle(
  page: Page, press: (page: Page) => Promise<void>, proof: string, url = "https://paulgraham.com/jessica.html",
) {
  await page.setViewportSize({ width: 1050, height: 800 });
  await openArticle(page, url);
  if (url === DEMO_ARTICLE) {
    const consent = page.getByRole("button", { name: "Reject all cookies", exact: true });
    await consent.click({ timeout: 2000 }).catch(() => {});
  }
  if (proof === "anthropic") await page.screenshot({ path: join(evidence, "article-before.png") });
  const start = performance.now();
  await press(page);
  const { faded } = await waitForState(page, "faded", 50_000).catch(async () => {
    const worker = await extensionWorker(page.context());
    const { selectionIssue } = await worker.evaluate(() => chrome.storage.session.get("selectionIssue"));
    throw new Error(`${proof}: ${selectionIssue || "page did not cut"}`);
  });
  const elapsed = (performance.now() - start) / 1000;
  assert.ok(faded > 0, "No sentences cut");
  if (proof === "anthropic") await page.screenshot({ path: join(evidence, "article-after.png") });
  const marker = page.locator("[data-filler-cut-marker]").first();
  await marker.click({ timeout: 5000 });
  const counter = page.locator("html");
  await poll(async () => Number(await counter.getAttribute("data-filler-cut-faded")), (value) => value < faded, 5000);
  console.log(`PASS ${proof}: ${elapsed.toFixed(2)} s to cut, ${faded} sentences hidden, marker expanded`);
}

async function fakeOAuth() {
  const algorithm = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) };
  const keys = await crypto.subtle.generateKey(algorithm, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
  let scenario: "success" | "denied" | "state" | "scope" = "success";
  let loopback = 0;
  let exchanges = 0;
  const callbacks: Bun.Server<undefined>[] = [];
  let auth: URLSearchParams;
  const client = "oaiapp_setup_test";

  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/api/accounts/authorize") {
      auth = url.searchParams;
      if (auth.get("client_id") !== "dynamic_agent_client" || auth.get("agent_name_hint") !== "Unpad" ||
          !auth.get("scope")?.includes("chatgpt.tokens.use.direct")) return new Response("Bad authorisation", { status: 400 });
      const callback = new URL(auth.get("redirect_uri")!);
      callbacks.push(Bun.serve({ hostname: "127.0.0.1", port: Number(callback.port), fetch() {
        loopback++;
        return new Response(null, { status: 404 });
      } }));
      callback.searchParams.set("state", scenario === "state" ? "wrong-state" : auth.get("state")!);
      if (scenario === "denied") callback.searchParams.set("error", "access_denied");
      else {
        callback.searchParams.set("code", "setup-test-code");
        callback.searchParams.set("client_id", client);
      }
      return Response.redirect(callback.href);
    }
    if (url.pathname === "/api/accounts/oauth/token") {
      exchanges++;
      const body = new URLSearchParams(await request.text());
      const challenge = Buffer.from(await crypto.subtle.digest("SHA-256",
        new TextEncoder().encode(body.get("code_verifier") ?? ""))).toString("base64url");
      if (body.get("client_id") !== client || body.get("redirect_uri") !== auth.get("redirect_uri") ||
          body.get("resource") !== "https://api.openai.com/v1" || challenge !== auth.get("code_challenge")) {
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      }
      const encoded = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
      const header = encoded({ alg: "RS256", kid: "test-key" });
      const claims = encoded({
        sub: "setup-test-user", iss: url.origin, aud: client, nonce: auth.get("nonce"),
        exp: Math.floor(Date.now() / 1000) + 3600, email: "reader@example.com",
      });
      const signature = await crypto.subtle.sign(algorithm.name, keys.privateKey, new TextEncoder().encode(`${header}.${claims}`));
      return Response.json({
        id_token: `${header}.${claims}.${Buffer.from(signature).toString("base64url")}`,
        scope: scenario === "scope" ? "openid" : "openid chatgpt.tokens.use.direct",
        access_token: "synthetic-access", refresh_token: "synthetic-refresh", expires_in: 3600,
      });
    }
    if (url.pathname === "/.well-known/jwks.json") return Response.json({ keys: [{ ...jwk, kid: "test-key" }] });
    if (url.pathname === "/api/accounts/oauth/revoke") return new Response();
    return new Response(null, { status: 404 });
  } });
  return {
    get origin() { return server.url.origin; },
    set value(value: typeof scenario) { scenario = value; },
    get exchanges() { return exchanges; },
    get loopback() { return loopback; },
    stop: async () => { await Promise.all([server, ...callbacks].map((listener) => listener.stop(true))); },
  };
}

const root = await mkdtemp("/tmp/filler-setup-extension-");
const results: string[] = [];
for (const id of args) {
  const directory = join(root, id);
  let report = `PASS ${id}`;
  try {
    if (id === "fresh") {
      await build(directory, "", true);
      await withActionBrowser(async (tabs, action) => {
        const options = await welcome(tabs);
        await captures(options, "welcome-first-run");
        const article = tabs.pages().find((page) => page !== options) ?? await tabs.newPage();
        await article.goto(xHomeUrl);
        await toggle(article);
        await article.locator("filler-cut-toast").getByText(issue.setup, { exact: true }).waitFor({ timeout: 5000 });
        await action.withPopup(article, async (popup) => {
          await popup.getByRole("button", { name: "Set up" }).waitFor();
          await captures(popup, "popup-not-connected", true);
        });
      }, "replay", directory);
    } else if (id === "oauth") {
      const fake = await fakeOAuth();
      try {
        await build(directory, fake.origin);
        for (const scenario of ["success", "denied", "state", "scope"] as const) {
          fake.value = scenario;
          await withActionBrowser(async (tabs, action) => {
            const options = await welcome(tabs);
            const before = fake.exchanges;
            for (const origin of new Set([hostPermission(fake.origin), "https://api.openai.com/*"])) {
              await preapproveHost(tabs, origin);
            }
            await options.getByRole("button", { name: "Continue with ChatGPT" }).click();
            const expected = scenario === "success" ? /Using ChatGPT plan/
              : scenario === "state" ? issue.auth : issue.denied;
            await options.getByText(expected).waitFor({ timeout: 10_000 }).catch(async () => {
              const problem = await options.locator("#problem").textContent();
              const paths = tabs.pages().map((page) => new URL(page.url()).pathname);
              throw new Error(`OAuth ${scenario}: ${problem || "no status"}, ${fake.exchanges - before} exchanges, ${fake.loopback} loopback, pages ${paths.join(", ")}`);
            });
            assert.equal(fake.exchanges - before, scenario === "success" || scenario === "scope" ? 1 : 0);
            assert.equal(fake.loopback, 0);
            const worker = await extensionWorker(tabs);
            assert.equal(await worker.evaluate(async () => (await chrome.declarativeNetRequest.getSessionRules()).length), 0);
            if (scenario === "success") {
              await captures(options, "welcome-chatgpt");
              await worker.evaluate((message) => chrome.storage.session.set({ selectionIssue: message }), issue.usage);
              await options.locator("#usage-primary").waitFor({ state: "visible" });
              await captures(options, "welcome-error");
              const article = await tabs.newPage();
              await article.goto("about:blank#error");
              await action.withPopup(article, async (popup) => {
                await popup.getByRole("link", { name: "Manage usage" }).waitFor();
                await captures(popup, "popup-error", true);
              });
            }
          }, "logged-out", directory);
          console.log(`PASS OAuth ${scenario}: no loopback requests and redirect rule cleared`);
        }
      } finally { await fake.stop(); }
    } else if (id === "anthropic" || id === "gemini" || id === "chatgpt") {
      const credential = await (id === "chatgpt" ? chatGPTToken() : apiKey(id));
      if (!credential) throw new Error("Credential unavailable");
      await build(directory);
      await withActionBrowser(async (tabs, action) => {
        const options = await welcome(tabs);
        const provider = providers[id];
        await preapproveHost(tabs, hostPermission(provider.origin));
        if (id === "chatgpt") {
          await requestHostFromOptions(options, hostPermission(provider.origin));
          const worker = await extensionWorker(tabs);
          await worker.evaluate(async (token) => {
            const dev = globalThis as unknown as { fillerCutTestChatGPT: (token: string) => Promise<void> };
            await dev.fillerCutTestChatGPT(token);
          }, credential);
          await options.getByText(/Using ChatGPT plan/).waitFor({ timeout: 5000 });
        } else {
          await options.getByRole("button", { name: "Use an API key instead" }).click();
          const enterKey = (value: string) => options.evaluate((value) => {
            const input = document.querySelector<HTMLInputElement>("#key")!;
            input.value = value;
            input.dispatchEvent(new Event("input"));
          }, value);
          if (id === "anthropic") {
            await enterKey("sk-ant-rejected");
            await options.getByRole("button", { name: "Connect", exact: true }).click();
            await options.getByText(issue.invalidKey, { exact: true }).waitFor({ timeout: 12_000 });
            console.log("PASS rejected key: replacement guidance shown");
          }
          await enterKey(credential);
          await options.getByText(`Recognized ${provider.label}`, { exact: true }).waitFor();
          await options.getByRole("button", { name: "Connect", exact: true }).click();
          await options.getByText(`Connected to ${provider.label}`, { exact: true }).waitFor({ timeout: 20_000 }).catch(async () => {
            throw new Error(`Connect: ${await options.locator("#problem").textContent() || "no status"}`);
          });
          if (id === "anthropic") await captures(options, "welcome-key");
        }
        const page = tabs.pages().find((p) => p !== options) ?? await tabs.newPage();
        await cutArticle(page, action.press, id, id === "gemini" ? DEMO_ARTICLE : undefined);
        await action.withPopup(page, async (popup) => {
          await popup.getByText(/Removed \d+ sentences?/).waitFor({ timeout: 5000 });
          await captures(popup, `popup-${id}`, true);
        });
        if (id !== "gemini") await cutArticle(page, action.press, id + "-long", "https://paulgraham.com/greatwork.html");
        const worker = await extensionWorker(tabs);
        const logged = await worker.evaluate(async () => Object.keys(await chrome.storage.local.get(null))
          .some((key) => key.startsWith("pendingEvents")));
        assert.equal(logged, false, "Non-bridge run created an event queue");
      }, "logged-out", directory);
    }
  } catch (error) {
    process.exitCode = 1;
    // Browser wait errors can include element values. Print only the failing assertion or selector.
    const summary = error instanceof Error ? error.message.split("\n")[0] : "unknown error";
    report = `FAIL ${id}: ${summary}`;
  }
  console.log(report);
  results.push(report);
  await Bun.write(join(evidence, "results.log"), results.join("\n") + "\n");
}
await rm(root, { recursive: true, force: true });
