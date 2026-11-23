import { expect, test } from "bun:test";
import { collapse, segment } from "../../src/core/segment";
import perfloop from "../fixtures/sentences/perfloop.json";

test("Perfloop splits before the numeric sentence", () => {
  const text = perfloop.sentences.join(" ");
  expect(segment(text).map((span) => span.text)).toEqual(perfloop.sentences);
});

test("abbreviations and quotes preserve contiguous source spans", () => {
  const text = '  Say, e.g.  "This works. That does too."\n Then stop.  ';
  const spans = segment(text);
  expect(spans.map((span) => span.text)).toEqual([
    'Say, e.g. "This works. That does too."', "Then stop.",
  ]);
  expect(spans.map((span) => span.text).join(" ")).toBe(collapse(text));
  for (const { start, end, text: sentence } of spans) {
    expect(collapse(text.slice(start, end))).toBe(sentence);
  }
});
