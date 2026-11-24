import { expect, test } from "bun:test";
import { PI_COMMAND, parseSelection, runPi, select } from "../../bridge/selector";
import type { PiSpawn } from "../../bridge/selector";

test("accepts ALL with or without JSON quotes, integers, and digit strings", () => {
  expect<unknown>(parseSelection(' "ALL"\n', 6)).toEqual({ kind: "keep-all" });
  expect<unknown>(parseSelection("ALL", 6)).toEqual({ kind: "keep-all" });
  for (const raw of ["[1,3]", '["1","3"]']) {
    expect<unknown>(parseSelection(raw, 6)).toEqual({ kind: "keep", keep: [1, 3] });
  }
});

test.each(["[0]", "[7]", "[1.5]", '[1,"1"]', "[]", "Keep [1]", "```json\n[1]\n```"])(
  "rejects invalid output %s",
  (raw) => expect(parseSelection(raw, 6)).toBeUndefined(),
);

test("only fades when at least three sentences are left out", () => {
  expect<unknown>(parseSelection("[1,2,3,4]", 6)).toEqual({ kind: "keep-all" });
  expect(parseSelection("[1,2,3]", 6)?.kind).toBe("keep");
});

test("accepts a standalone SKIP only for checked pages", async () => {
  expect(parseSelection("SKIP", 6)).toBeUndefined();
  expect(parseSelection('"SKIP"', 6, true)).toBeUndefined();
  expect(parseSelection("SKIP: project page", 6, true)).toBeUndefined();
  const doc = { title: "Project", sentences: ["One."], check: { url: "https://example.com/repo" } };
  const prompts: string[] = [];
  const result = await select(doc, "Base\n", "Rules\n", async (prompt) => {
    prompts.push(prompt);
    return "SKIP\n";
  });
  expect(prompts).toHaveLength(1);
  expect(prompts[0]).toStartWith("First decide whether this page should be cut at all.");
  expect(prompts[0]).toEndWith("Base\nRules\n\nURL: https://example.com/repo\nTitle: Project\nSOURCE:\n1: One.\n");
  expect(result).toEqual({ selection: { kind: "skip" }, raw: "SKIP\n" });
});

test("formats the prompt and retries invalid output once", async () => {
  const doc = { title: "Page title", sentences: ["One.", "Two.", "Three.", "Four."] };
  const prompts: string[] = [];
  const result = await select(doc, "Base\n", "Rules\n", async (prompt) => {
    prompts.push(prompt);
    return prompts.length === 1 ? "prose" : "[1]";
  });
  const prompt = "Base\nRules\n\nTitle: Page title\nSOURCE:\n1: One.\n2: Two.\n3: Three.\n4: Four.\n";
  expect(prompts).toEqual([prompt, prompt]);
  expect<unknown>(result).toEqual({ selection: { kind: "keep", keep: [1] }, raw: "[1]" });

  let attempts = 0;
  await expect(select(doc, "", "", async () => {
    attempts++;
    return "[]";
  })).rejects.toThrow("Pi returned an invalid selection twice");
  expect(attempts).toBe(2);
});

test("uses the specified Pi command, scrubs the environment, and kills it on timeout", async () => {
  const killed: string[] = [];
  const exit = Promise.withResolvers<number>();
  const spawn: PiSpawn = (cmd, options) => {
    expect(cmd).toEqual([...PI_COMMAND, "prompt"]);
    expect(options.cwd).toBe("/tmp");
    expect(options.stdin.name).toBe("/dev/null");
    for (const name of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY",
      "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDECODE", "CODEX_API_KEY"]) {
      expect(options.env[name]).toBeUndefined();
    }
    return {
      stdout: new Blob().stream(),
      exited: exit.promise,
      kill(signal) {
        killed.push(signal);
        exit.resolve(1);
      },
    };
  };

  await expect(runPi("prompt", "/tmp", spawn, 5)).rejects.toThrow("Pi timed out");
  expect(killed).toEqual(["SIGKILL"]);
});
