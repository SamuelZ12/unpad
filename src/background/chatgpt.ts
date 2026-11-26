import { hostPermission, issue } from "../shared/connection";
import { connectionFetch, providers } from "./providers";

const issuer = process.env.FILLER_CUT_DEV === "1"
  ? (process.env.FILLER_CUT_AUTH_ORIGIN || "https://auth.openai.com")
  : "https://auth.openai.com";
const resource = "https://api.openai.com/v1";
const directScope = "chatgpt.tokens.use.direct";
const scopes = `openid profile email offline_access resource.invoke ${directScope}`;
const registrationClient = "dynamic_agent_client";
const callbackPath = "callback.html";
const ruleId = 1;
const oauthPath = "/api/accounts/oauth";

export const chatgptOrigins = [...new Set([hostPermission(issuer), hostPermission(resource), "http://127.0.0.1/*"])];

type Account = { clientId: string; sub: string; email?: string };
export type ChatGPTSession = { clientId: string; refresh: string };
type Access = { token: string; expiresAt: number };
type Attempt = {
  tabId: number;
  state: string;
  nonce: string;
  verifier: string;
  redirect: string;
  account?: Account;
  expiresAt: number;
};
type Tokens = {
  id_token?: string; refresh_token?: string; access_token?: string; expires_in?: number; scope?: string; error?: string;
};

let authWork = Promise.resolve<unknown>(undefined);
function serialize<T>(run: () => Promise<T>): Promise<T> {
  const next = authWork.then(run);
  authWork = next.catch(() => {});
  return next;
}

function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
function decode(value: string) {
  return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));
}
function random() {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

export function savedAccounts(): Promise<Account[]> {
  return chrome.storage.local.get("chatgptAccounts").then(({ chatgptAccounts }) => (chatgptAccounts as Account[] | undefined) ?? []);
}

async function pendingAttempt(): Promise<Attempt | undefined> {
  return (await chrome.storage.session.get("chatgptAttempt")).chatgptAttempt as Attempt | undefined;
}

async function clearAttempt() {
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] });
  await chrome.storage.session.remove("chatgptAttempt");
}

export function cancelChatGPT(tabId: number) {
  return serialize(async () => {
    if ((await pendingAttempt())?.tabId === tabId) await clearAttempt();
  });
}

export function startChatGPT(clientId?: string) {
  return serialize(async () => {
    const account = (await savedAccounts()).find((row) => row.clientId === clientId);
    const previous = await pendingAttempt();
    if (previous) {
      await clearAttempt();
      await chrome.tabs.remove(previous.tabId).catch(() => {});
    }

    let chatgptHost = (await chrome.storage.local.get("chatgptHost")).chatgptHost as string | undefined;
    if (!chatgptHost) {
      chatgptHost = `urn:uuid:${crypto.randomUUID()}`;
      await chrome.storage.local.set({ chatgptHost });
    }
    const tab = await chrome.tabs.create({ url: "about:blank" });
    if (tab.id === undefined) throw new Error(issue.auth);
    const tabId = tab.id;
    // The listener is a tab-scoped redirect. Choose a fresh loopback port for each attempt.
    const port = 49152 + (crypto.getRandomValues(new Uint16Array(1))[0] % 16384);
    const redirect = `http://127.0.0.1:${port}/auth/callback`;
    const attempt: Attempt = {
      tabId, account, redirect, state: random(), nonce: random(), verifier: random(),
      expiresAt: Date.now() + 10 * 60_000,
    };

    try {
      const challenge = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(attempt.verifier));
      const auth = new URL("/api/accounts/authorize", issuer);
      auth.search = new URLSearchParams({
        client_id: account?.clientId ?? registrationClient, ext_agent_host_id: chatgptHost,
        response_type: "code", redirect_uri: redirect, scope: scopes, resource,
        state: attempt.state, nonce: attempt.nonce, code_challenge_method: "S256",
        code_challenge: base64url(new Uint8Array(challenge)),
        ...(account ? { prompt: "consent" } : { agent_name_hint: chrome.runtime.getManifest().name }),
      }).toString();
      await chrome.storage.session.set({ chatgptAttempt: attempt });
      await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [ruleId],
        addRules: [{
          id: ruleId,
          condition: {
            tabIds: [tabId],
            resourceTypes: [chrome.declarativeNetRequest.ResourceType.MAIN_FRAME],
            regexFilter: `^http://127[.]0[.]0[.]1:${port}/auth/callback[?](.*)$`,
          },
          action: {
            type: chrome.declarativeNetRequest.RuleActionType.REDIRECT,
            redirect: { regexSubstitution: chrome.runtime.getURL(callbackPath) + "#\\1" },
          },
        }],
      });
      await chrome.tabs.update(tabId, { url: auth.href });
    } catch (error) {
      await clearAttempt();
      await chrome.tabs.remove(tabId).catch(() => {});
      throw error;
    }
  });
}

async function tokenRequest(params: Record<string, string>): Promise<{ response: Response; tokens: Tokens }> {
  const response = await connectionFetch(issuer + oauthPath + "/token", {
    method: "POST", body: new URLSearchParams({ ...params, resource }),
  });
  return { response, tokens: await response.json().catch(() => ({})) };
}

async function verifyIdentity(token: string | undefined, clientId: string, nonce: string): Promise<Account> {
  const parts = token?.split(".");
  if (!parts || parts.length !== 3) throw new Error(issue.auth);
  const [header, body, signature] = parts;
  const { kid, alg } = JSON.parse(new TextDecoder().decode(decode(header)));
  if (alg !== "RS256" || typeof kid !== "string") throw new Error(issue.auth);
  const jwks = await connectionFetch(issuer + "/.well-known/jwks.json");
  const { keys }: { keys: (JsonWebKey & { kid?: string })[] } = await jwks.json();
  const jwk = keys.find((key) => key.kid === kid && key.kty === "RSA" && (!key.use || key.use === "sig"));
  if (!jwk) throw new Error(issue.auth);
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  if (!await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, decode(signature),
    new TextEncoder().encode(`${header}.${body}`))) throw new Error(issue.auth);
  const claims = JSON.parse(new TextDecoder().decode(decode(body)));
  const validAudience = claims.aud === clientId || (Array.isArray(claims.aud) && claims.aud.includes(clientId) &&
    (claims.aud.length === 1 || claims.azp === clientId));
  if (claims.iss !== issuer || !validAudience || claims.nonce !== nonce ||
    !Number.isFinite(claims.exp) || claims.exp * 1000 <= Date.now() || typeof claims.sub !== "string" || !claims.sub) {
    throw new Error(issue.auth);
  }
  return { clientId, sub: claims.sub, ...(typeof claims.email === "string" && { email: claims.email }) };
}

function accessFrom(tokens: Tokens): Access {
  if (typeof tokens.access_token !== "string" || !tokens.access_token ||
      typeof tokens.expires_in !== "number" || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0) {
    throw new Error(issue.auth);
  }
  return { token: tokens.access_token, expiresAt: Date.now() + tokens.expires_in * 1000 };
}

export function finishChatGPT(tabId: number, query: string) {
  return serialize(async () => {
    const attempt = await pendingAttempt();
    if (tabId !== attempt?.tabId) return;
    await clearAttempt();
    const params = new URLSearchParams(query);
    if (attempt.expiresAt < Date.now() || params.get("state") !== attempt.state) throw new Error(issue.auth);
    if (params.get("error") === "access_denied") throw new Error(issue.denied);
    if (params.has("error")) throw new Error(issue.auth);
    const code = params.get("code");
    const returnedClient = params.get("client_id");
    const clientId = attempt.account?.clientId ?? returnedClient;
    if (!code || !clientId || clientId === registrationClient || (returnedClient && returnedClient !== clientId)) {
      throw new Error(issue.auth);
    }

    const { response, tokens } = await tokenRequest({
      grant_type: "authorization_code", client_id: clientId, code, redirect_uri: attempt.redirect,
      code_verifier: attempt.verifier,
    });
    if (!response.ok) throw new Error(response.status >= 500 ? issue.offline : issue.auth);
    const account = await verifyIdentity(tokens.id_token, clientId, attempt.nonce);
    if (attempt.account && account.sub !== attempt.account.sub) throw new Error(issue.auth);

    const accounts = (await savedAccounts()).filter((row) => row.clientId !== clientId);
    await chrome.storage.local.set({ chatgptAccounts: [...accounts, account] });
    if (!tokens.scope?.split(/\s+/).includes(directScope)) throw new Error(issue.denied);
    const access = accessFrom(tokens);
    if (typeof tokens.refresh_token !== "string" || !tokens.refresh_token) throw new Error(issue.auth);
    await chrome.storage.session.set({ chatgptAccess: access });
    await chrome.storage.local.set({
      chatgptSession: { clientId, refresh: tokens.refresh_token } satisfies ChatGPTSession,
      engine: { kind: "chatgpt", model: providers.chatgpt.model },
    });
  });
}

const terminalRefresh = new Set([
  "invalid_grant", "invalid_refresh_token", "token_expired", "refresh_token_expired",
  "refresh_token_invalidated", "refresh_token_reused",
]);

export function chatGPTAccess(rejected?: string): Promise<string> {
  return serialize(async () => {
    const access = (await chrome.storage.session.get("chatgptAccess")).chatgptAccess as Access | undefined;
    if (access && access.token !== rejected && access.expiresAt > Date.now() + 60_000) return access.token;
    const session = await currentChatGPTSession();
    if (!session) throw new Error(issue.signedOut);
    const { response, tokens } = await tokenRequest({
      grant_type: "refresh_token", client_id: session.clientId, refresh_token: session.refresh,
    });
    if (!response.ok) {
      if (terminalRefresh.has(tokens.error ?? "")) {
        await chrome.storage.local.remove("chatgptSession");
        await chrome.storage.session.remove("chatgptAccess");
        throw new Error(issue.signedOut);
      }
      throw new Error(response.status >= 500 ? issue.offline : issue.auth);
    }
    if (tokens.refresh_token) {
      await chrome.storage.local.set({ chatgptSession: { ...session, refresh: tokens.refresh_token } });
    }
    if (tokens.scope && !tokens.scope.split(/\s+/).includes(directScope)) {
      await chrome.storage.session.remove("chatgptAccess");
      throw new Error(issue.denied);
    }
    const renewed = accessFrom(tokens);
    await chrome.storage.session.set({ chatgptAccess: renewed });
    return renewed.token;
  });
}

export function disconnectChatGPT() {
  return serialize(async () => {
    const attempt = await pendingAttempt();
    if (attempt) {
      await clearAttempt();
      await chrome.tabs.remove(attempt.tabId).catch(() => {});
    }
    const session = await currentChatGPTSession();
    await chrome.storage.session.remove("chatgptAccess");
    let revoked = !session;
    if (session) {
      for (const delay of [0, 250, 1000]) {
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
        const response = await connectionFetch(issuer + oauthPath + "/revoke", {
          method: "POST",
          body: new URLSearchParams({ token: session.refresh, token_type_hint: "refresh_token", client_id: session.clientId }),
          signal: AbortSignal.timeout(4000),
        }).catch(() => undefined);
        revoked = response?.ok ?? false;
        if (response && response.status < 500) break;
      }
    }
    await chrome.storage.local.remove("chatgptSession");
    return revoked;
  });
}

export async function chatGPTModels() {
  const token = await chatGPTAccess();
  const response = await connectionFetch(resource + "/models", { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(response.status === 401 ? issue.signedOut : issue.failed);
  const { models }: { models?: { slug: string; display_name: string; visibility: string }[] } = await response.json();
  return (models ?? []).filter(({ visibility }) => visibility === "list")
    .map(({ slug, display_name }) => ({ slug, label: display_name }));
}

export async function currentChatGPTSession() {
  return (await chrome.storage.local.get("chatgptSession")).chatgptSession as ChatGPTSession | undefined;
}
