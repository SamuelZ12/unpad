import { expect, test } from "bun:test";
import { MAX_SENTENCES, MIN_SENTENCES } from "../../src/shared/config";
import {
  parseErrorResponse, parseEventsRequest, parseEventsResponse, parseHealthResponse,
  parseSelectRequest, parseSelectResponse,
} from "../../src/shared/wire";

const cacheKey = "a".repeat(64);

test("select request requires a title and a supported number of strings", () => {
  const sentences = Array(MIN_SENTENCES).fill("A sentence.");
  expect(parseSelectRequest({ title: "", sentences })).toEqual({ title: "", sentences });
  expect(parseSelectRequest({ title: "", sentences, key: true })).toEqual({ title: "", sentences, key: true });
  expect(parseSelectRequest({ title: "", sentences, key: false })).toBeUndefined();
  expect(parseSelectRequest({ sentences })).toBeUndefined();
  expect(parseSelectRequest({ title: "", sentences: [42, ...sentences.slice(1)] })).toBeUndefined();
  expect(parseSelectRequest({ title: "", sentences: sentences.slice(1) })).toBeUndefined();
  expect(parseSelectRequest({ title: "", sentences: Array(MAX_SENTENCES + 1).fill("A sentence.") })).toBeUndefined();
});

test("select response requires a cache key and a selection with integer ids", () => {
  const selection = { kind: "keep", keep: [1, 3] };
  expect<unknown>(parseSelectResponse({ cacheKey, selection })).toEqual({ cacheKey, selection });
  expect<unknown>(parseSelectResponse({ cacheKey, selection, key: [] })).toEqual({ cacheKey, selection, key: [] });
  expect<unknown>(parseSelectResponse({ cacheKey, selection, key: [3, 1] })).toEqual({ cacheKey, selection, key: [3, 1] });
  expect<unknown>(parseSelectResponse({ cacheKey, selection, key: [3, 3] })).toEqual({ cacheKey, selection });
  expect(parseSelectResponse({ cacheKey, selection: { kind: "keep-all" } })).toBeDefined();
  expect<unknown>(parseSelectResponse({ cacheKey, selection: { kind: "skip" } }))
    .toEqual({ cacheKey, selection: { kind: "skip" } });
  expect(parseSelectResponse({ selection })).toBeUndefined();
  expect(parseSelectResponse({ cacheKey, selection: { kind: "keep", keep: [1.5] } })).toBeUndefined();
});

test("a page check carries only the HTTP origin and pathname", () => {
  const doc = { title: "", sentences: Array(MIN_SENTENCES).fill("A sentence.") };
  const checked = { ...doc, check: { url: "https://example.com:8443/an%20article" } };
  expect(parseSelectRequest(checked)).toEqual(checked);
  for (const check of [null, {}, { url: "file:///path" }, { url: "/path" },
    { url: "https://user:pass@example.com/path" }, { url: "https://example.com/path?x=1" },
    { url: "https://example.com/path#" }]) {
    expect(parseSelectRequest({ ...doc, check })).toBeUndefined();
  }
});

test("events request checks each event", () => {
  const common = { id: "id", at: "2026-11-23T00:00:00Z", pageView: "view", url: "https://x.com/" };
  const events = [
    { ...common, type: "shown", cacheKey, total: 6, faded: 3 },
    { ...common, type: "restore", cacheKey, sentenceId: 2, text: "Sentence." },
    { ...common, type: "reveal", heldMs: 100 },
    { ...common, type: "shown", cacheKey, total: 6, faded: 3, marks: 2 },
    { ...common, type: "unmark", cacheKey, sentenceId: 3, text: "Key sentence." },
  ];
  expect<unknown>(parseEventsRequest({ events })).toEqual({ events });
  expect(parseEventsRequest({})).toBeUndefined();
  expect(parseEventsRequest({ events: [{ ...events[1], sentenceId: "2" }] })).toBeUndefined();
  expect(parseEventsRequest({ events: [{ ...events[3], marks: 4 }] })).toBeUndefined();
  expect(parseEventsRequest({ events: [{ ...events[4], text: undefined }] })).toBeUndefined();
});

test("response parsers require their fields", () => {
  expect(parseErrorResponse({ error: "Pi failed" })).toEqual({ error: "Pi failed" });
  expect(parseErrorResponse({})).toBeUndefined();
  expect(parseEventsResponse({ accepted: 3 })).toEqual({ accepted: 3 });
  expect(parseEventsResponse({})).toBeUndefined();
  const health = { selectorVersion: "a".repeat(12), rulesVersion: "b".repeat(12) };
  expect<unknown>(parseHealthResponse(health)).toEqual(health);
  expect(parseHealthResponse({ selectorVersion: health.selectorVersion })).toBeUndefined();
});
