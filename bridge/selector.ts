import { MIN_FADED } from "../src/shared/config";
import type { Selection, SentenceId } from "../src/shared/types";
import type { SelectRequest } from "../src/shared/wire";

export const PI_COMMAND = [
  "pi", "-p", "--no-session", "--no-tools", "--no-extensions", "--no-mcp",
  "--model", "anthropic/claude-opus-5-5", "--thinking", "off", "--",
] as const;

export const PARSER_VERSION = 1;

const SCRUBBED_ENV = [
  "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY",
  "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDECODE", "CODEX_API_KEY",
];

export function parseSelection(raw: string, sentenceCount: number): Selection | undefined {
  const answer = raw.trim();
  if (answer === "ALL" || answer === '"ALL"') return { kind: "keep-all" };

  let values: unknown;
  try {
    values = JSON.parse(answer);
  } catch {
    return undefined;
  }
  if (!Array.isArray(values) || values.length === 0) return undefined;

  const keep = new Set<SentenceId>();
  for (const value of values) {
    const id = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
    if (typeof id !== "number" || !Number.isInteger(id) || id < 1 || id > sentenceCount) return undefined;
    const sentenceId = id as SentenceId;
    if (keep.has(sentenceId)) return undefined;
    keep.add(sentenceId);
  }

  if (sentenceCount - keep.size < MIN_FADED) return { kind: "keep-all" };
  return { kind: "keep", keep: [...keep] };
}

type PiOptions = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdin: ReturnType<typeof Bun.file>;
  stdout: "pipe";
  stderr: "ignore";
};

export type PiSpawn = (cmd: string[], options: PiOptions) => {
  stdout: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  kill: (signal: "SIGKILL") => void;
};

export async function runPi(
  prompt: string,
  cwd: string,
  spawn: PiSpawn = (cmd, options) => Bun.spawn(cmd, options),
  timeoutMs = 20_000,
): Promise<string> {
  const env = { ...process.env };
  for (const key of SCRUBBED_ENV) delete env[key];

  let child;
  try {
    child = spawn([...PI_COMMAND, prompt], {
      cwd, env, stdin: Bun.file("/dev/null"), stdout: "pipe", stderr: "ignore",
    });
  } catch {
    throw new Error("Could not start Pi");
  }

  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, timeoutMs);
  try {
    const [raw, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    if (timedOut) throw new Error("Pi timed out");
    if (code !== 0) throw new Error(`Pi exited with code ${code}`);
    return raw;
  } finally {
    clearTimeout(timeout);
  }
}

export async function select(
  doc: SelectRequest,
  base: string,
  rules: string,
  ask: (prompt: string) => Promise<string>,
): Promise<{ selection: Selection; raw: string }> {
  const title = doc.title ? `Title: ${doc.title.replace(/\s+/g, " ")}\n` : "";
  const sentences = doc.sentences.map((sentence, i) => `${i + 1}: ${sentence}\n`).join("");
  const prompt = `${base}${rules}\n${title}SOURCE:\n${sentences}`;
  let raw = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    raw = await ask(prompt);
    const selection = parseSelection(raw, doc.sentences.length);
    if (selection) return { selection, raw };
  }
  throw new Error(`Pi returned an invalid selection twice: ${JSON.stringify(raw.slice(0, 300))}`);
}
