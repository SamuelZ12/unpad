import { MIN_FADED, MIN_MARK_SENTENCES, MARK_CAP_MULTIPLIER } from "../shared/config";
import { hostPermission, issue, type Engine } from "../shared/connection";
import { docKey, sha256 } from "../shared/keys";
import { CHECK_PROMPT, InvalidSelection, PARSER_VERSION, select, selectWithKey, type Ask } from "../shared/selector";
import type { CacheKey } from "../shared/types";
import { parseSelectResponse, type SelectRequest, type SelectResponse } from "../shared/wire";
import { chatGPTAccess } from "./chatgpt";
import { askProvider, ProviderFailure, providers } from "./providers";

export type Selector = (doc: SelectRequest) => Promise<SelectResponse>;

export function bridgeSelector(url: string, fetcher: (url: URL, init: RequestInit) => Promise<Response> = fetch): Selector {
  return async (doc) => {
    const response = await fetcher(new URL("/select", url), {
      method: "POST",
      redirect: "error",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(doc),
      signal: AbortSignal.timeout(45_000),
    }).catch(() => { throw new Error(issue.offline); });
    if (response.status === 429) throw new Error(issue.rate);
    if (response.status === 503) throw new Error(issue.offline);
    if (!response.ok) throw new Error(issue.failed);
    const picks = parseSelectResponse(await response.json().catch(() => undefined));
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

const planAsk = (model: string, sessionId: string): Ask => async (input) => {
  const { token } = await chatGPTAccess(sessionId);
  try {
    return await askProvider("chatgpt", token, model)(input);
  } catch (error) {
    if (!(error instanceof ProviderFailure) || error.message !== issue.signedOut) throw error;
    return askProvider("chatgpt", (await chatGPTAccess(sessionId, token)).token, model)(input);
  }
};

export function localSelector(engine: Exclude<Engine, { kind: "bridge" }>, about: string, sessionId?: string): Selector {
  const id = engine.kind === "chatgpt" ? "chatgpt" : engine.provider;
  return async (doc) => {
    if (!await chrome.permissions.contains({ origins: [hostPermission(providers[id].origin)] })) {
      throw new Error(issue.permission);
    }
    const access = engine.kind === "chatgpt" ? await chatGPTAccess(sessionId ?? (process.env.FILLER_CUT_DEV === "1" ? "dev" : "signed-out")) : undefined;
    const fingerprint = access?.sessionId ?? await sha256(engine.kind === "key" ? engine.key : "");
    const ask = engine.kind === "key" ? askProvider(id, engine.key, engine.model)
      : planAsk(engine.model, fingerprint);
    const key = await docKey(doc.title, doc.sentences);
    const cacheKey = await sha256(JSON.stringify([
      PARSER_VERSION, CHECK_PROMPT, MIN_FADED, MIN_MARK_SENTENCES, MARK_CAP_MULTIPLIER,
      prompt, keyPrompt, id, engine.model, fingerprint, about, key, doc.check?.url, !!doc.key,
    ])) as CacheKey;

    const existing = pending.get(cacheKey);
    if (existing) return existing;
    const work = (async () => {
      const { selections } = await chrome.storage.local.get("selections").catch(() => ({ selections: undefined }));
      const cached = Array.isArray(selections) && selections.find((row) => row?.cacheKey === cacheKey);
      const parsed = parseSelectResponse(cached);
      if (parsed) return parsed;

      try {
        if (doc.key) {
          let planLimit = false;
          const selectAsk: Ask = (input) => ask(input).catch((error) => {
            if (error instanceof Error && error.message === issue.usage) planLimit = true;
            throw error;
          });
          const { selection, key, keyFailed } = await selectWithKey(doc, prompt, keyPrompt, about, selectAsk);
          if (planLimit) throw new Error(issue.usage);
          const picks = { cacheKey, selection, key };
          if (!keyFailed) await save(picks);
          return picks;
        }
        const { selection } = await select(doc, prompt, about, ask);
        const picks = { cacheKey, selection };
        await save(picks);
        return picks;
      } catch (error) {
        if (error instanceof InvalidSelection) throw new Error(issue.reply);
        throw error;
      }
    })();
    pending.set(cacheKey, work);
    try { return await work; }
    finally { pending.delete(cacheKey); }
  };
}
