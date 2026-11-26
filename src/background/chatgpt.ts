import { hostPermission, issue, type Engine } from "../shared/connection";
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
export type ChatGPTSession = { id: string; clientId: string; refresh: string };
type Access = { sessionId: string; token: string; expiresAt: number };
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
      await chrome.tabs.remove(previous.tabId).catch(() => {});
      await clearAttempt();
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
      await chrome.tabs.remove(tabId).catch(() => {});
      await clearAttempt();
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
  if (claims.iss !== issuer || !validAudience || (claims.azp !== undefined && claims.azp !== clientId) || claims.nonce !== nonce ||
    !Number.isFinite(claims.exp) || claims.exp * 1000 <= Date.now() || typeof claims.sub !== "string" || !claims.sub) {
    throw new Error(issue.auth);
  }
  return { clientId, sub: claims.sub, ...(typeof claims.email === "string" && { email: claims.email }) };
}

function accessFrom(tokens: Tokens, sessionId: string): Access {
  if (typeof tokens.access_token !== "string" || !tokens.access_token ||
      typeof tokens.expires_in !== "number" || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0) {
    throw new Error(issue.auth);
  }
  return { sessionId, token: tokens.access_token, expiresAt: Date.now() + tokens.expires_in * 1000 };
}

export function finishChatGPT(tabId: number, query: string) {
  return serialize(async () => {
    const attempt = await pendingAttempt();
    if (tabId !== attempt?.tabId) return false;
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
    const sessionId = crypto.randomUUID();
    const access = accessFrom(tokens, sessionId);
    if (typeof tokens.refresh_token !== "string" || !tokens.refresh_token) throw new Error(issue.auth);
    const previousSession = await currentChatGPTSession();
    const { engine } = await chrome.storage.local.get("engine") as { engine?: Engine };
    const model = engine?.kind === "chatgpt" && attempt.account?.clientId === clientId
      ? engine.model : providers.chatgpt.model;
    await chrome.storage.session.set({ chatgptAccess: access });
    await chrome.storage.local.set({
      chatgptSession: { id: sessionId, clientId, refresh: tokens.refresh_token } satisfies ChatGPTSession,
      engine: { kind: "chatgpt", model },
    });
    if (previousSession) await revoke(previousSession);
    return true;
  });
}

const terminalRefresh = new Set([
  "invalid_grant", "invalid_refresh_token", "token_expired", "refresh_token_expired",
  "refresh_token_invalidated", "refresh_token_reused",
]);

export function chatGPTAccess(expectedSession?: string, rejected?: string): Promise<Access> {
  return serialize(async () => {
    const access = (await chrome.storage.session.get("chatgptAccess")).chatgptAccess as Access | undefined;
    const session = await currentChatGPTSession();
    const sessionId = session?.id ?? (process.env.FILLER_CUT_DEV === "1" && access?.sessionId === "dev" ? "dev" : undefined);
    if (expectedSession !== undefined && sessionId !== expectedSession) throw new Error(issue.signedOut);
    if (access?.sessionId === sessionId && access && access.token !== rejected && access.expiresAt > Date.now() + 60_000) return access;
    if (!session) throw new Error(issue.signedOut);
    if (!await chrome.permissions.contains({ origins: [hostPermission(issuer)] })) throw new Error(issue.permission);
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
    const renewed = accessFrom(tokens, session.id);
    await chrome.storage.session.set({ chatgptAccess: renewed });
    return renewed;
  });
}

async function revoke(session: ChatGPTSession) {
  for (const delay of [0, 250, 1000]) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    const response = await connectionFetch(issuer + oauthPath + "/revoke", {
      method: "POST",
      body: new URLSearchParams({ token: session.refresh, token_type_hint: "refresh_token", client_id: session.clientId }),
      signal: AbortSignal.timeout(4000),
    }).catch(() => undefined);
    if (response && response.status < 500) return response.ok;
  }
  return false;
}

export function disconnectChatGPT() {
  return serialize(async () => {
    const attempt = await pendingAttempt();
    if (attempt) {
      await chrome.tabs.remove(attempt.tabId).catch(() => {});
      await clearAttempt();
    }
    const session = await currentChatGPTSession();
    await chrome.storage.session.remove("chatgptAccess");
    await chrome.storage.local.remove("chatgptSession");
    return !session || await revoke(session);
  });
}

export async function chatGPTModels() {
  const catalog = (token: string) => connectionFetch(resource + "/models", {
    headers: { authorization: `Bearer ${token}` },
  });
  const { sessionId, token } = await chatGPTAccess();
  let response = await catalog(token);
  if (response.status === 401) response = await catalog((await chatGPTAccess(sessionId, token)).token);
  if (!response.ok) throw new Error(response.status === 401 ? issue.signedOut : issue.failed);
  const { models, data }: {
    models?: { slug: string; display_name: string; visibility: string }[];
    data?: { id: string }[];
  } = await response.json();
  return models ? models.filter(({ visibility }) => visibility === "list")
    .map(({ slug, display_name }) => ({ slug, label: display_name }))
    : (data ?? []).map(({ id }) => ({ slug: id, label: id }));
}

export async function currentChatGPTSession() {
  return (await chrome.storage.local.get("chatgptSession")).chatgptSession as ChatGPTSession | undefined;
}
