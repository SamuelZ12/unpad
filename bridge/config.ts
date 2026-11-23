import { homedir } from "node:os";
import { join } from "node:path";
import { MIN_FADED } from "../src/shared/config";
import { sha256 } from "../src/shared/keys";
import type { RulesVersion, SelectorVersion } from "../src/shared/types";
import type { HealthResponse } from "../src/shared/wire";
import { PARSER_VERSION, PI_COMMAND } from "./selector";

export async function versionsFor(
  prompt: string,
  rules: Uint8Array<ArrayBuffer>,
  minFaded = MIN_FADED,
): Promise<HealthResponse> {
  const [selector, reader] = await Promise.all([
    sha256(JSON.stringify([prompt, PI_COMMAND, minFaded, PARSER_VERSION])),
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

  const [prompt, rulesBytes] = await Promise.all([
    Bun.file(new URL("./prompt.txt", import.meta.url)).text(),
    Bun.file(rulesFile).bytes(),
  ]);
  return {
    port, dataDir, prompt,
    rules: new TextDecoder().decode(rulesBytes),
    versions: await versionsFor(prompt, rulesBytes),
  };
}

export type BridgeConfig = Awaited<ReturnType<typeof loadConfig>>;
