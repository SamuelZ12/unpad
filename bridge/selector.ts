import { MIN_FADED, MIN_MARK_SENTENCES, SENTENCES_PER_MARK } from "../src/shared/config";
import type { Selection, SentenceId } from "../src/shared/types";
import type { SelectRequest } from "../src/shared/wire";

export const PI_COMMAND = [
  "pi", "-p", "--no-session", "--no-tools", "--no-extensions", "--no-mcp",
  "--model", "anthropic/claude-opus-5-5", "--thinking", "off", "--",
] as const;

export const PARSER_VERSION = 2;
export const CHECK_PROMPT = "First decide whether this page should be cut at all. Answer READ if the main content is an article, essay, blog post, news story, long social post or paper: continuous prose by an author, meant to be read from start to finish. Answer SKIP for anything else: a README or project page, API or reference documentation, an issue or comment thread, a question-and-answer page, a feed, index or list of posts, search results, a profile, a product or pricing page, an app screen. If the answer is SKIP, output the single word SKIP and nothing else. Otherwise: ";

const SCRUBBED_ENV = [
  "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY",
  "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDECODE", "CODEX_API_KEY",
];

export function parseSelection(raw: string, sentenceCount: number, checked = false): Selection | undefined {
  // The check asks READ or SKIP first. Pi may say READ before the array.
  const answer = (checked ? raw.replace(/^\s*READ\b[.:]?/, "") : raw).trim();
  if (checked && answer === "SKIP") return { kind: "skip" };
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
    // Long answers sometimes name an ID twice. The repeat changes nothing.
    keep.add(id as SentenceId);
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

function sourceFor(doc: SelectRequest) {
  const title = doc.title ? `Title: ${doc.title.replace(/\s+/g, " ")}\n` : "";
  const sentences = doc.sentences.map((sentence, i) => `${i + 1}: ${sentence}\n`).join("");
  return `\n${title}SOURCE:\n${sentences}`;
}

export function keyPromptFor(doc: SelectRequest, prompt: string, rules: string) {
  return `${prompt}${rules}${sourceFor(doc)}`;
}

export function parseKey(raw: string, count: number): SentenceId[] | undefined {
  // Pi wrote a note after the array in 2 of 3 runs on a 159-sentence page.
  // The first array is the answer; a mark is a hint, so a retry is not worth a second call.
  const first = raw.match(/^\s*\[[\d\s,]*\]/)?.[0];
  let values: unknown;
  try {
    values = JSON.parse(first ?? "");
  } catch {
    return undefined;
  }
  if (!Array.isArray(values) || !values.every((id) => Number.isInteger(id) && id >= 1 && id <= count)) return undefined;
  // Pi repeated an ID in 2 of 2 key answers on 581- and 789-sentence essays. Keep its first rank.
  return [...new Set<SentenceId>(values)];
}

export async function selectWithKey(
  doc: SelectRequest,
  base: string,
  keyPrompt: string,
  rules: string,
  ask: (prompt: string) => Promise<string>,
) {
  const keep = select(doc, base, rules, ask);
  const count = doc.sentences.length;
  const key = count >= MIN_MARK_SENTENCES
    ? ask(keyPromptFor(doc, keyPrompt, rules)).then((raw) => parseKey(raw, count), () => undefined)
    : undefined;
  const result = await keep;
  if (result.selection.kind === "skip" || !key) return { ...result, key: [], keyFailed: false };
  const kept = result.selection.kind === "keep" ? new Set(result.selection.keep) : undefined;
  const answer = await key;
  const ids = (answer ?? []).filter((id) => !kept || kept.has(id));
  return { ...result, key: ids.slice(0, Math.ceil(count / SENTENCES_PER_MARK)), keyFailed: !answer };
}

export async function select(
  doc: SelectRequest,
  base: string,
  rules: string,
  ask: (prompt: string) => Promise<string>,
): Promise<{ selection: Selection; raw: string }> {
  const checkUrl = doc.check ? `\nURL: ${doc.check.url}` : "";
  const prompt = `${doc.check ? CHECK_PROMPT : ""}${base}${rules}${checkUrl}${sourceFor(doc)}`;
  let raw = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    raw = await ask(prompt);
    const selection = parseSelection(raw, doc.sentences.length, !!doc.check);
    if (selection) return { selection, raw };
  }
  throw new Error(`Pi returned an invalid selection twice: ${JSON.stringify(raw.slice(0, 300))}`);
}
