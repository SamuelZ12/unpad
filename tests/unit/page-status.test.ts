import { expect, test } from "bun:test";
import { pageStatus } from "../../src/core/page-status";
import { reduce, type PageState } from "../../src/core/state";
import type { CacheKey, Doc, DocKey, SentenceId } from "../../src/shared/types";

const id = (value: number) => value as SentenceId;
const doc: Doc = { key: "article" as DocKey, surface: "blog", title: "", sentences: ["a", "b", "c", "d", "e", "f"] };
const empty: PageState = { lensOn: true, holding: false, docs: new Map() };
const waiting = reduce(empty, { type: "doc-found", doc });
const answer = { type: "picks-arrived", docKey: doc.key, cacheKey: "picks" as CacheKey } as const;

test("a scanned feed without eligible posts has nothing to cut", () => {
  expect(pageStatus(empty, true)).toEqual({ kind: "nothing-to-cut" });
  expect(pageStatus(waiting, true, [])).toEqual({ kind: "nothing-to-cut" });
});

test("an article reports pending and failed selection", () => {
  expect(pageStatus(waiting, true)).toEqual({ kind: "reading" });
  const failed = reduce(waiting, { type: "picks-failed", docKey: doc.key, reason: "Bridge unavailable" });
  expect(pageStatus(failed, true)).toEqual({ kind: "failed", reason: "Bridge unavailable" });
});

test("skipped and keep-all articles with no marks have nothing to cut", () => {
  for (const kind of ["skip", "keep-all"] as const) {
    expect(pageStatus(reduce(waiting, { ...answer, selection: { kind } }), true))
      .toEqual({ kind: "nothing-to-cut" });
  }
});

test("turning off the lens keeps the count, and restoring sentences lowers it", () => {
  const ready = reduce(waiting, { ...answer, selection: { kind: "keep", keep: [id(1), id(4)] }, key: [id(1)] });
  expect(pageStatus(ready, true)).toEqual({ kind: "cut", lensOn: true, removed: 4, marks: 1 });
  const restored = reduce(ready, { type: "restore", docKey: doc.key, ids: [id(2), id(3)] });
  const off = reduce(restored, { type: "lens-set", on: false });
  expect(pageStatus(off, true)).toEqual({ kind: "cut", lensOn: false, removed: 2, marks: 1 });
});

test("the lens stays available when every removed sentence is expanded", () => {
  const ready = reduce(waiting, { ...answer, selection: { kind: "keep", keep: [id(1)] } });
  const expanded = reduce(ready, { type: "restore", docKey: doc.key, ids: [2, 3, 4, 5, 6].map(id) });
  expect(pageStatus(expanded, true)).toEqual({ kind: "cut", lensOn: true, removed: 0, marks: 0 });
});

test("a marked-only article counts", () => {
  const ready = reduce(waiting, { ...answer, selection: { kind: "keep-all" }, key: [id(1)] });
  expect(pageStatus(ready, true)).toEqual({ kind: "cut", lensOn: true, removed: 0, marks: 1 });
});

test("an unscanned page is reading", () => {
  expect(pageStatus(empty, false)).toEqual({ kind: "reading" });
});

test("available cuts take priority over pending and failed documents", () => {
  const other = { ...doc, key: "other" as DocKey };
  const pending = reduce(waiting, { type: "doc-found", doc: other });
  const failed = reduce(pending, { type: "picks-failed", docKey: other.key, reason: "Offline" });
  expect(pageStatus(failed, true)).toEqual({ kind: "reading" });
  const available = reduce(failed, { ...answer, selection: { kind: "keep", keep: [id(1)] } });
  expect(pageStatus(available, true)).toEqual({ kind: "cut", lensOn: true, removed: 5, marks: 0 });
});
