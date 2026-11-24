import { expect, test } from "bun:test";
import { PI_COMMAND, parseKey, parseSelection, runPi, select, selectWithKey } from "../../bridge/selector";
import type { PiSpawn } from "../../bridge/selector";
import { maxMarks } from "../../src/shared/config";

test("accepts ALL with or without JSON quotes, integers, and digit strings", () => {
  expect<unknown>(parseSelection(' "ALL"\n', 6)).toEqual({ kind: "keep-all" });
  expect<unknown>(parseSelection("ALL", 6)).toEqual({ kind: "keep-all" });
  for (const raw of ["[1,3]", '["1","3"]']) {
    expect<unknown>(parseSelection(raw, 6)).toEqual({ kind: "keep", keep: [1, 3] });
  }
});

test("a repeated ID counts once", () => {
  expect<unknown>(parseSelection('[1,3,"1"]', 6)).toEqual({ kind: "keep", keep: [1, 3] });
  expect<unknown>(parseKey("[4,1,4,2]", 6)).toEqual([4, 1, 2]);
});

test.each(["[0]", "[7]", "[1.5]", "[]", "Keep [1]", "```json\n[1]\n```"])(
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
  expect<unknown>(parseSelection("READ\n[1,2,3]", 6, true)).toEqual({ kind: "keep", keep: [1, 2, 3] });
  expect(parseSelection("READ\n[1,2,3]", 6)).toBeUndefined();
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

test("key answers are ordered arrays of in-range integers", () => {
  expect<unknown>(parseKey("[6,1,3]", 6)).toEqual([6, 1, 3]);
  expect(parseKey("[]", 6)).toEqual([]);
  expect<unknown>(parseKey("[4,1]\n\nToo many? Fine.\n[4]\n", 6)).toEqual([4, 1]);
  for (const raw of ["[0]", "[7]", "[1.5]", '["3"]', "Here: [1]", "ALL", "null"]) {
    expect(parseKey(raw, 6)).toBeUndefined();
  }
});

test.each([[19, 0], [28, 11], [74, 18], [789, 57]])(
  "caps marks at %i sentences",
  (sentences, cap) => expect(maxMarks(sentences)).toBe(cap),
);

test("key and keep calls overlap, then marks are capped in priority order", async () => {
  const doc = { title: "", sentences: Array(28).fill("Sentence."), key: true } as const;
  const keep = Promise.withResolvers<string>();
  const prompts: string[] = [];
  const pending = selectWithKey(doc, "Keep", "Key", "", (prompt) => {
    prompts.push(prompt);
    return prompt.startsWith("Keep") ? keep.promise : Promise.resolve("[12,4,2,3,1,6,7,8,9,10,11,5]");
  });
  expect(prompts).toHaveLength(2);
  keep.resolve("ALL");
  expect<unknown>((await pending).key).toEqual([12, 4, 2, 3, 1, 6, 7, 8, 9, 10, 11]);
});

test("short documents use one call, and keep-all can carry keys from 20 sentences", async () => {
  const pick = (count: number) => {
    let calls = 0;
    const doc = { title: "", sentences: Array(count).fill("Sentence.") };
    return selectWithKey(doc, "Keep", "Key", "", async () => ++calls === 1 ? "ALL" : "[3,2,1]")
      .then(({ key }) => ({ key, calls }));
  };
  expect(await pick(19)).toEqual({ key: [], calls: 1 });
  expect<unknown>(await pick(20)).toEqual({ key: [3, 2, 1], calls: 2 });
});

test("only the capped marks join the keep selection, in source order", async () => {
  const doc = { title: "", sentences: Array(20).fill("Sentence.") };
  const kept = Array.from({ length: 17 }, (_, index) => 17 - index);
  const raw = JSON.stringify(kept);
  const result = await selectWithKey(doc, "Keep", "Key", "", async (prompt) =>
    prompt.startsWith("Key") ? "[19,18,3,19,1,2,4,5,6,7,20]" : raw);
  expect<unknown>(result).toEqual({
    raw,
    selection: { kind: "keep", keep: Array.from({ length: 19 }, (_, index) => index + 1) },
    key: [19, 18, 3, 1, 2, 4, 5, 6, 7],
    keyFailed: false,
  });
});

test("marks that fill the keep selection switch it to keep-all", async () => {
  const doc = { title: "", sentences: Array(20).fill("Sentence.") };
  const raw = JSON.stringify(Array.from({ length: 17 }, (_, index) => index + 1));
  const result = await selectWithKey(doc, "Keep", "Key", "", async (prompt) =>
    prompt.startsWith("Key") ? "[20,18,19]" : raw);
  expect<unknown>(result).toEqual({
    raw,
    selection: { kind: "keep-all" },
    key: [20, 18, 19],
    keyFailed: false,
  });
});

test("failed and malformed key answers leave keep-all intact and SKIP drops keys", async () => {
  const doc = { title: "", sentences: Array(20).fill("Sentence."), check: { url: "https://example.com/" } };
  for (const keyAnswer of [() => { throw new Error("Pi timed out"); }, () => "Here: [1]"]) {
    const result = await selectWithKey(doc, "Keep", "Key", "", async (prompt) =>
      prompt.startsWith("Key") ? keyAnswer() : "ALL");
    expect(result).toEqual({ raw: "ALL", selection: { kind: "keep-all" }, key: [], keyFailed: true });
  }
  expect(await selectWithKey(doc, "Keep", "Key", "", async (prompt) => prompt.startsWith("Key") ? "[1]" : "SKIP"))
    .toEqual({ raw: "SKIP", selection: { kind: "skip" }, key: [], keyFailed: false });
});
