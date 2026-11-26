export { CHECK_PROMPT, PARSER_VERSION, parseSelection, parseKey, keyPromptFor, select, selectWithKey } from "../src/shared/selector";

export const PI_COMMAND = [
  "pi", "-p", "--no-session", "--no-tools", "--no-extensions", "--no-mcp",
  "--model", "anthropic/claude-opus-5-5", "--thinking", "off", "--",
] as const;

const SCRUBBED_ENV = [
  "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY",
  "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDECODE", "CODEX_API_KEY",
];

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
