import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { docKey, sha256 } from "../src/shared/keys";
import type { CacheKey } from "../src/shared/types";
import { parseSelectResponse } from "../src/shared/wire";
import type { HealthResponse, SelectRequest, SelectResponse } from "../src/shared/wire";

export async function cacheKeyFor(doc: SelectRequest, versions: HealthResponse): Promise<CacheKey> {
  const { selectorVersion, rulesVersion } = versions;
  const key = await docKey(doc.title, doc.sentences);
  const check = doc.check ? `:${doc.check.url}` : "";
  return await sha256(`${selectorVersion}:${rulesVersion}:${key}${check}`) as CacheKey;
}

export function cachePath(dataDir: string, key: CacheKey): string {
  return join(dataDir, "cache", `${key}.json`);
}

export async function readCache(dataDir: string, key: CacheKey): Promise<SelectResponse | undefined> {
  try {
    const entry = JSON.parse(await readFile(cachePath(dataDir, key), "utf8"));
    const picks = parseSelectResponse(entry);
    return picks?.cacheKey === key ? picks : undefined;
  } catch (error) {
    if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

interface CacheEntry extends Omit<SelectRequest, "key">, HealthResponse, SelectResponse {
  readonly raw: string;
  readonly ms: number;
}

export async function writeCache(dataDir: string, entry: CacheEntry): Promise<void> {
  const path = cachePath(dataDir, entry.cacheKey);
  const temp = `${path}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(entry) + "\n", { mode: 0o600, flag: "wx" });
    await rename(temp, path);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
}
