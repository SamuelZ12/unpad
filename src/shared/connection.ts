export const CHATGPT_USAGE = "https://chatgpt.com/settings/usage";
export const DEMO_ARTICLE = "https://claude.com/blog/how-warp-builds-self-improving-agents-on-claude";

export type ProviderId = "anthropic" | "openai" | "gemini" | "openrouter";

export type Engine =
  | { kind: "chatgpt"; model: string }
  | { kind: "key"; provider: ProviderId; key: string; model: string }
  | { kind: "bridge"; url: string };

export type PublicEngine = Exclude<Engine, { kind: "key" }> | Omit<Extract<Engine, { kind: "key" }>, "key">;

export const issue = {
  setup: "Open the extension and choose Set up to get started.",
  blockedKey: "This Anthropic account blocks requests from Chrome. Connect a different API key.",
  invalidKey: "The API key was rejected. Replace it in settings.",
  credit: "Your provider has reached its credit limit. Check your provider’s billing.",
  rate: "Your provider has reached its request limit. Try again later.",
  offline: "The connection could not be reached. Check your connection and try again.",
  signedOut: "Your ChatGPT session ended. Sign in again in settings.",
  usage: "You’ve reached a ChatGPT usage limit.",
  ineligible: "This ChatGPT account can’t use plan access here. Connect an API key.",
  permission: "Connection access was declined. Try again and allow access.",
  model: "This model can’t be used. Choose another model in Advanced.",
  reply: "The reply could not be read. Try the shortcut or switch again.",
  failed: "The reply could not be read. Try again.",
  denied: "ChatGPT plan access was declined. Try again to grant access.",
  auth: "ChatGPT sign-in could not be completed. Try again.",
} as const;

export function hostPermission(url: string) {
  const { protocol, hostname } = new URL(url);
  return `${protocol}//${hostname}/*`;
}

export const bridgeAddressHelp = "Use an HTTPS address or an HTTP address on this computer.";

export function bridgeAddress(value: string) {
  const url = URL.parse(value);
  if (!url || !["http:", "https:"].includes(url.protocol) ||
      url.hostname.includes("*") || url.username || url.password || url.origin !== url.href.replace(/\/$/, "")) return;
  if (url.protocol === "http:" && !["127.0.0.1", "[::1]", "localhost"].includes(url.hostname)) return;
  return url.origin;
}
