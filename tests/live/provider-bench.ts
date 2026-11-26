import { askProvider, providers } from "../../src/background/providers";
import { selectWithKey } from "../../src/shared/selector";
import { parseSelectRequest } from "../../src/shared/wire";
import { apiKey, chatGPTToken } from "./lib/credentials";

const candidates = {
  anthropic: [providers.anthropic.model, "claude-haiku-4-5"],
  gemini: [providers.gemini.model, "gemini-3.1-flash-lite"],
  chatgpt: [providers.chatgpt.model],
  openai: [providers.openai.model],
  openrouter: [providers.openrouter.model],
};

const [prompt, keyPrompt] = await Promise.all([
  Bun.file("bridge/prompt.txt").text(), Bun.file("bridge/key-prompt.txt").text(),
]);
const fixtures = await Promise.all(["wang", "warp", "perfloop"].map(async (name) => {
  const doc = parseSelectRequest(await Bun.file(`tests/fixtures/sentences/${name}.json`).json());
  if (!doc) throw new Error(`Invalid fixture ${name}`);
  return { name, doc };
}));

for (const id of Object.keys(candidates) as (keyof typeof candidates)[]) {
  if (!Bun.argv.slice(2).includes(id)) continue;
  const credential = await (id === "chatgpt" ? chatGPTToken() : apiKey(id));
  if (!credential) {
    console.log(`SKIP ${id}: credential unavailable`);
    continue;
  }
  const times = new Map(candidates[id].map((model) => [model, [] as number[]]));
  for (let run = 0; run < 3; run++) {
    for (const { name, doc } of fixtures) {
      for (const model of candidates[id]) {
        const started = performance.now();
        try {
          const result = await selectWithKey(doc, prompt, keyPrompt, "", askProvider(id, credential, model));
          const faded = result.selection.kind === "keep" ? doc.sentences.length - result.selection.keep.length : 0;
          if (result.keyFailed || (name === "perfloop" ? faded !== 0 : faded < 3)) throw new Error();
          const seconds = (performance.now() - started) / 1000;
          times.get(model)!.push(seconds);
          console.log(`PASS ${model} ${name} ${seconds.toFixed(2)} s, ${faded} cut, ${result.key.length} marked`);
        } catch {
          console.log(`FAIL ${model} ${name} after ${((performance.now() - started) / 1000).toFixed(2)} s`);
        }
      }
    }
  }
  for (const [model, samples] of times) {
    samples.sort((a, b) => a - b);
    const stats = samples.length
      ? `, median ${samples[Math.floor((samples.length - 1) / 2)].toFixed(2)} s, range ${samples[0].toFixed(2)} to ${samples.at(-1)!.toFixed(2)} s`
      : "";
    console.log(`${model} ${samples.length}/9${stats}`);
  }
}
