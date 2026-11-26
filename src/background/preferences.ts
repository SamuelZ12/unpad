import { bridgeAddress, type Engine, type PublicEngine } from "../shared/connection";

const defaultBridge = process.env.BRIDGE_URL ?? "";
export const initialEngine: Engine | undefined = defaultBridge ? { kind: "bridge", url: defaultBridge } : undefined;

export async function readPreferences(): Promise<{ engine?: Engine; about: string }> {
  const { engine, about } = await chrome.storage.local.get(["engine", "about"]) as { engine?: Engine | null; about?: string };
  return { engine: engine === undefined ? initialEngine : engine ?? undefined, about: about ?? "" };
}

export function publicEngine(engine?: Engine): PublicEngine | undefined {
  if (engine?.kind === "key") return { kind: "key", provider: engine.provider, model: engine.model };
  return engine;
}

export function parseBridge(value: unknown) {
  return typeof value === "string" ? bridgeAddress(value.trim()) : undefined;
}
