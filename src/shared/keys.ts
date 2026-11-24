import type { DocKey } from "./types";

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function randomId() {
  return crypto.randomUUID?.() ?? hex(crypto.getRandomValues(new Uint8Array(16)));
}

export async function sha256(data: string | Uint8Array<ArrayBuffer>): Promise<string> {
  // The extension worker can hash text even when the article uses plain HTTP.
  if (!crypto.subtle && typeof data === "string") return chrome.runtime.sendMessage({ type: "hash", data });
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}

export async function docKey(title: string, sentences: readonly string[]): Promise<DocKey> {
  return await sha256(JSON.stringify([title, ...sentences])) as DocKey;
}
