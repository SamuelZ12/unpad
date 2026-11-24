import { homedir } from "node:os";
import { join } from "node:path";
import { MIN_FADED, MIN_MARK_SENTENCES, SENTENCES_PER_MARK } from "../src/shared/config";
import { sha256 } from "../src/shared/keys";
import type { RulesVersion, SelectorVersion } from "../src/shared/types";
import type { HealthResponse } from "../src/shared/wire";
import { CHECK_PROMPT, PARSER_VERSION, PI_COMMAND } from "./selector";

export async function versionsFor(
  prompt: string,
  rules: Uint8Array<ArrayBuffer>,
  minFaded = MIN_FADED,
  keyPrompt?: string,
): Promise<HealthResponse> {
  const selectorInputs: unknown[] = [prompt, CHECK_PROMPT, PI_COMMAND, minFaded, PARSER_VERSION];
  if (keyPrompt !== undefined) selectorInputs.push(keyPrompt, MIN_MARK_SENTENCES, SENTENCES_PER_MARK);
  const [selector, reader] = await Promise.all([
    sha256(JSON.stringify(selectorInputs)),
    sha256(rules),
  ]);
  return {
    selectorVersion: selector.slice(0, 12) as SelectorVersion,
    rulesVersion: reader.slice(0, 12) as RulesVersion,
  };
}

export async function loadConfig() {
  const root = join(homedir(), ".pi/agent/filler-cut");
  const dataDir = process.env.FILLER_CUT_DATA ?? join(root, "data");
  const rulesFile = process.env.FILLER_CUT_RULES ?? join(root, "engine/reader-rules.txt");
  const port = Number(process.env.PORT ?? 18931);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");

  const [prompt, keyPrompt, rulesBytes] = await Promise.all([
    Bun.file(new URL("./prompt.txt", import.meta.url)).text(),
    Bun.file(new URL("./key-prompt.txt", import.meta.url)).text(),
    Bun.file(rulesFile).bytes(),
  ]);
  const [versions, keyVersions] = await Promise.all([
    versionsFor(prompt, rulesBytes),
    versionsFor(prompt, rulesBytes, MIN_FADED, keyPrompt),
  ]);
  return {
    port, dataDir, prompt, keyPrompt, versions, keyVersions,
    rules: new TextDecoder().decode(rulesBytes),
  };
}

export type BridgeConfig = Awaited<ReturnType<typeof loadConfig>>;
