import { homedir } from "node:os";
import { join } from "node:path";

async function readCredential(command: string[]) {
  const child = Bun.spawn(command, { stdout: "pipe", stderr: "ignore" });
  const [code, value] = await Promise.all([child.exited, new Response(child.stdout).text()]);
  return code === 0 && value.trim() ? value.trim() : undefined;
}

export function apiKey(id: "anthropic" | "gemini" | "openai" | "openrouter") {
  if (id === "openai") return Promise.resolve(process.env.OPENAI_API_KEY);
  if (id === "openrouter") return Promise.resolve(process.env.OPENROUTER_API_KEY);
  const entry = id === "anthropic" ? "anthropic-api-key-pi" : "gemini-api-key-free";
  return readCredential(["security", "find-generic-password", "-s", entry, "-w"]);
}

export function chatGPTToken() {
  return readCredential([process.execPath, join(homedir(), ".pi/agent/filler-cut/proto-siwc/token.ts")]);
}
