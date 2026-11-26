import { issue, type ProviderId } from "../shared/connection";

type Wire = { path: string; headers: Record<string, string>; body: unknown };
type Provider = {
  label: string;
  origin: string;
  model: string;
  request: (token: string, model: string, prompt: string) => Wire;
  read: (response: Response) => Promise<string>;
};
type KeyProvider = Provider & { key: RegExp; keysUrl: string };
type ErrorBody = { error?: { code?: string; type?: string; message?: string }; detail?: unknown };

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const messages = (content: string) => [{ role: "user", content }];
const openaiOrigin = "https://api.openai.com";

function responses(stream: boolean): Provider["request"] {
  return (token, model, prompt) => ({
    path: "/v1/responses", headers: bearer(token),
    body: { model, input: messages(prompt), store: false, stream, ...((stream || /^gpt-[56]([.-]|$)/.test(model)) && { reasoning: { effort: "low" } }),
      ...(!stream && { max_output_tokens: 12_000 }) },
  });
}

async function readResponses(response: Response) {
  const data: { output?: { content?: { type: string; text?: string }[] }[] } = await response.json();
  return data.output?.flatMap((item) => item.content ?? [])
    .filter(({ type }) => type === "output_text").map(({ text }) => text).join("") ?? "";
}

async function readPlanStream(response: Response) {
  const reader = response.body?.pipeThrough(new TextDecoderStream()).getReader();
  if (!reader) throw new Error(issue.failed);
  let buffer = "";
  let answer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += value;
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trimEnd();
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith("data:") || line.slice(5).trim() === "[DONE]") continue;
        const event = JSON.parse(line.slice(5));
        if (event.type === "response.output_text.delta") answer += event.delta;
        if (event.type === "response.completed" && event.response?.status === "completed") return answer;
        if (event.type === "response.failed" || event.type === "error") {
          throw providerFailure("chatgpt", 0, { error: event.response?.error ?? event.error ?? event });
        }
        if (event.type === "response.incomplete") throw new Error(issue.failed);
      }
    }
    throw new Error(issue.failed);
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export const providers = {
  chatgpt: {
    label: "ChatGPT", origin: openaiOrigin, model: "gpt-6.2-sol", request: responses(true), read: readPlanStream,
  },
  anthropic: {
    label: "Anthropic", origin: "https://api.anthropic.com", model: "claude-haiku-5-5",
    key: /^sk-ant-/, keysUrl: "https://platform.claude.com/settings/keys",
    request: (token, model, prompt) => ({
      path: "/v1/messages", headers: { "x-api-key": token, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
      body: { model, messages: messages(prompt), max_tokens: 12_000 },
    }),
    async read(response) {
      const data: { content?: { type: string; text?: string }[] } = await response.json();
      return data.content?.filter(({ type }) => type === "text").map(({ text }) => text).join("") ?? "";
    },
  },
  gemini: {
    label: "Google Gemini", origin: "https://generativelanguage.googleapis.com", model: "gemini-3.5-flash-lite",
    key: /^(AIza|AQ\.)/, keysUrl: "https://aistudio.google.com/apikey",
    request: (token, model, prompt) => ({
      path: `/v1beta/models/${encodeURIComponent(model)}:generateContent`, headers: { "x-goog-api-key": token },
      body: { contents: [{ parts: [{ text: prompt }] }], generationConfig: {
        maxOutputTokens: 12_000, ...(/^gemini-3(?:\.\d+)?-flash(?:-|$)/.test(model) && { thinkingConfig: { thinkingLevel: "minimal" } }),
      } },
    }),
    async read(response) {
      const data: { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] } = await response.json();
      return data.candidates?.[0]?.content?.parts?.filter(({ thought }) => !thought).map(({ text }) => text).join("") ?? "";
    },
  },
  openrouter: {
    label: "OpenRouter", origin: "https://openrouter.ai", model: "google/gemini-3.1-flash-lite",
    key: /^sk-or-/, keysUrl: "https://openrouter.ai/settings/keys",
    request: (token, model, prompt) => ({
      path: "/api/v1/chat/completions", headers: bearer(token),
      body: { model, messages: messages(prompt), max_tokens: 12_000 },
    }),
    async read(response) {
      const data: { choices?: { message?: { content?: string } }[] } = await response.json();
      return data.choices?.[0]?.message?.content ?? "";
    },
  },
  openai: {
    label: "OpenAI", origin: openaiOrigin, model: "gpt-6-luna",
    key: /^sk-(proj|svcacct)-/, keysUrl: "https://platform.openai.com/api-keys", request: responses(false), read: readResponses,
  },
} satisfies { chatgpt: Provider } & Record<ProviderId, KeyProvider>;

export function recognizeKey(key: string): ProviderId | undefined {
  return (Object.keys(providers) as (keyof typeof providers)[]).find(
    (id): id is ProviderId => id !== "chatgpt" && providers[id].key.test(key),
  );
}

export class ProviderFailure extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

function providerFailure(id: keyof typeof providers, status: number, body: ErrorBody | null) {
  const error = body?.error;
  const code = error?.code ?? error?.type;
  let message: string = issue.failed;
  if (code === "subscription_sharing_usage_limit_exceeded") message = issue.usage;
  else if (code === "subscription_sharing_user_not_eligible") message = issue.ineligible;
  else if (id === "chatgpt" && (status === 401 || code === "subscription_sharing_invalid_user")) message = issue.signedOut;
  else if (id === "anthropic" && error?.message?.startsWith("CORS requests are not allowed for this Organization")) {
    message = issue.blockedKey;
  }
  else if (id !== "chatgpt" && (status === 401 || status === 403 || code === "API_KEY_INVALID" ||
    /API key not valid/i.test(error?.message ?? ""))) message = issue.invalidKey;
  else if (status === 402 || code === "insufficient_quota" || /credit balance/i.test(error?.message ?? "")) message = issue.credit;
  else if (status === 429) message = issue.rate;
  else if (status === 404 || code === "model_not_found") message = issue.model;
  else if (status >= 500) message = issue.offline;
  return new ProviderFailure(message, status);
}

export function askProvider(id: keyof typeof providers, token: string, model: string) {
  const provider = providers[id];
  return async (prompt: string) => {
    const { path, headers, body } = provider.request(token, model, prompt);
    const response = await connectionFetch(provider.origin + path, {
      method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body),
    });
    if (!response.ok) throw providerFailure(id, response.status, await response.json().catch(() => ({})));
    const answer = await provider.read(response).catch((error) => {
      if (error instanceof ProviderFailure) throw error;
      throw new Error((error instanceof TypeError || (error instanceof DOMException && ["AbortError", "TimeoutError"].includes(error.name))) ? issue.offline : issue.reply);
    });
    if (typeof answer !== "string" || !answer.trim()) throw new Error(issue.reply);
    // Some models wrap a bare array in a Markdown fence.
    return answer.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, "$1");
  };
}

export async function connectionFetch(url: string, init?: RequestInit) {
  try {
    return await fetch(url, { ...init, redirect: "error", signal: init?.signal ?? AbortSignal.timeout(45_000) });
  } catch {
    throw new Error(issue.offline);
  }
}
