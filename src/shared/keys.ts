import type { DocKey } from "./types";

export async function sha256(data: string | Uint8Array<ArrayBuffer>): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function docKey(title: string, sentences: readonly string[]): Promise<DocKey> {
  return await sha256(JSON.stringify([title, ...sentences])) as DocKey;
}
