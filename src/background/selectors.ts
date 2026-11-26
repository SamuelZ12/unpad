import { MIN_FADED, MIN_MARK_SENTENCES, MARK_CAP_MULTIPLIER } from "../shared/config";
import { hostPermission, issue, type Engine } from "../shared/connection";
import { docKey, sha256 } from "../shared/keys";
import { CHECK_PROMPT, InvalidSelection, PARSER_VERSION, select, selectWithKey, type Ask } from "../shared/selector";
import type { CacheKey } from "../shared/types";
import { parseSelectResponse, type SelectRequest, type SelectResponse } from "../shared/wire";
import { chatGPTAccess, currentChatGPTSession } from "./chatgpt";
import { askProvider, ProviderFailure, providers } from "./providers";

export type Selector = (doc: SelectRequest) => Promise<SelectResponse>;

export function bridgeSelector(url: string, fetcher: (url: URL, init: RequestInit) => Promise<Response> = fetch): Selector {
  return async (doc) => {
    const response = await fetcher(new URL("/select", url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(doc),
      signal: AbortSignal.timeout(45_000),
    }).catch(() => { throw new Error(issue.offline); });
    if (!response.ok) throw new Error(issue.failed);
    const picks = parseSelectResponse(await response.json());
    if (!picks || (picks.selection.kind === "keep" && picks.selection.keep.some((id) => id > doc.sentences.length))) {
      throw new Error(issue.failed);
    }
    return picks;
  };
}

const prompt = process.env.FILLER_CUT_PROMPT ?? "";
const keyPrompt = process.env.FILLER_CUT_KEY_PROMPT ?? "";
const pending = new Map<CacheKey, Promise<SelectResponse>>();
const cacheLimit = 256;
let cacheWrites = Promise.resolve();

function save(picks: SelectResponse) {
  cacheWrites = cacheWrites.then(async () => {
    const { selections } = await chrome.storage.local.get("selections");
    const entries = [...(Array.isArray(selections) ? selections : []), picks].slice(-cacheLimit);
    await chrome.storage.local.set({ selections: entries });
  }).catch(() => {});
  return cacheWrites;
}

const planAsk = (model: string): Ask => async (input) => {
  const token = await chatGPTAccess();
  try {
    return await askProvider("chatgpt", token, model)(input);
  } catch (error) {
    if (!(error instanceof ProviderFailure) || error.message !== issue.signedOut) throw error;
    return askProvider("chatgpt", await chatGPTAccess(token), model)(input);
  }
};

export function localSelector(engine: Exclude<Engine, { kind: "bridge" }>, about: string): Selector {
  const id = engine.kind === "chatgpt" ? "chatgpt" : engine.provider;
  const ask = engine.kind === "chatgpt" ? planAsk(engine.model) : askProvider(id, engine.key, engine.model);
  return async (doc) => {
    if (!await chrome.permissions.contains({ origins: [hostPermission(providers[id].origin)] })) {
      throw new Error(issue.permission);
    }
    // Check the session before serving a cached cut so a signed-out user gets recovery guidance.
    const account = engine.kind === "chatgpt" ? await chatGPTAccess() : engine.key;
    const chatgptSession = engine.kind === "chatgpt" ? await currentChatGPTSession() : undefined;
    const fingerprint = await sha256(chatgptSession?.clientId ?? account);
    const key = await docKey(doc.title, doc.sentences);
    const cacheKey = await sha256(JSON.stringify([
      PARSER_VERSION, CHECK_PROMPT, MIN_FADED, MIN_MARK_SENTENCES, MARK_CAP_MULTIPLIER,
      prompt, keyPrompt, id, engine.model, fingerprint, about, key, doc.check?.url, !!doc.key,
    ])) as CacheKey;

    const existing = pending.get(cacheKey);
    if (existing) return existing;
    const work = (async () => {
      const { selections } = await chrome.storage.local.get("selections");
      const cached = Array.isArray(selections) && selections.find((row) => row?.cacheKey === cacheKey);
      const parsed = parseSelectResponse(cached);
      if (parsed) return parsed;

      try {
        if (doc.key) {
          const { selection, key, keyFailed } = await selectWithKey(doc, prompt, keyPrompt, about, ask);
          const picks = { cacheKey, selection, key };
          if (!keyFailed) await save(picks);
          return picks;
        }
        const { selection } = await select(doc, prompt, about, ask);
        const picks = { cacheKey, selection };
        await save(picks);
        return picks;
      } catch (error) {
        if (error instanceof InvalidSelection) throw new Error(issue.failed);
        throw error;
      }
    })();
    pending.set(cacheKey, work);
    try { return await work; }
    finally { pending.delete(cacheKey); }
  };
}
