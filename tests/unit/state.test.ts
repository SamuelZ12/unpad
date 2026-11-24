import { expect, test } from "bun:test";
import { fadedIds, markedIds, reduce, removedRuns, view, type PageState } from "../../src/core/state";
import type { CacheKey, Doc, DocKey, SentenceId } from "../../src/shared/types";

const id = (n: number) => n as SentenceId;
const doc: Doc = { key: "a" as DocKey, surface: "blog", title: "", sentences: ["a", "b", "c", "d", "e", "f"] };
const initial: PageState = { lensOn: true, holding: false, docs: new Map() };

test("the view is derived from waiting, picks, lens, hold and restores", () => {
  expect(view(initial)).toBe("idle");
  const waiting = reduce(initial, { type: "doc-found", doc });
  expect(view(waiting)).toBe("waiting");
  const answer = { type: "picks-arrived", docKey: doc.key, cacheKey: "b" as CacheKey, selection: { kind: "keep", keep: [id(1), id(5)] } } as const;
  expect(reduce(initial, answer)).toBe(initial);
  const faded = reduce(waiting, answer);
  expect(reduce(faded, { type: "doc-found", doc })).toBe(faded);
  expect(view(faded)).toBe("faded");
  expect(removedRuns(faded, doc.key)).toEqual([[2, 3, 4].map(id), [id(6)]]);
  expect(reduce(faded, { type: "restore", docKey: doc.key, ids: [id(3)] })).toBe(faded);
  const revealed = reduce(faded, { type: "hold-start" });
  expect(view(revealed)).toBe("revealed");
  expect(fadedIds(revealed, doc.key)).toEqual([]);
  const restored = reduce(reduce(revealed, { type: "hold-end" }), { type: "restore", docKey: doc.key, ids: [2, 3, 4].map(id) });
  expect(fadedIds(restored, doc.key)).toEqual([id(6)]);
  const off = reduce(restored, { type: "lens-set", on: false });
  expect(view(off)).toBe("picks-ready");
  expect(fadedIds(off, doc.key)).toEqual([]);
  expect(view(reduce(off, { type: "navigated" }))).toBe("idle");
  expect(view(reduce(waiting, { ...answer, selection: { kind: "keep-all" } }))).toBe("idle");
  expect(view(reduce(waiting, { type: "picks-failed", docKey: doc.key, reason: "Offline" }))).toBe("idle");
});

test("marks follow the lens, can be unmarked once, and do not overlap fades", () => {
  const waiting = reduce(initial, { type: "doc-found", doc });
  const answer = { type: "picks-arrived", docKey: doc.key, cacheKey: "b" as CacheKey,
    selection: { kind: "keep", keep: [id(1), id(2)] }, key: [id(2), id(1), id(3), id(7)] } as const;
  const ready = reduce(waiting, answer);
  expect(markedIds(ready, doc.key)).toEqual([id(2), id(1)]);
  const unmark = { type: "unmark", docKey: doc.key, id: id(2) } as const;
  const held = reduce(ready, { type: "hold-start" });
  expect(markedIds(held, doc.key)).toEqual([]);
  expect(reduce(held, unmark)).toBe(held);
  expect(markedIds(reduce(held, { type: "hold-end" }), doc.key)).toEqual([id(2), id(1)]);
  const unmarked = reduce(ready, unmark);
  expect(markedIds(unmarked, doc.key)).toEqual([id(1)]);
  expect(fadedIds(unmarked, doc.key)).toEqual(fadedIds(ready, doc.key));
  expect(reduce(unmarked, unmark)).toBe(unmarked);
  const off = reduce(unmarked, { type: "lens-set", on: false });
  expect(markedIds(off, doc.key)).toEqual([]);
  expect(markedIds(reduce(off, { type: "lens-set", on: true }), doc.key)).toEqual([id(1)]);
  expect(markedIds(reduce(unmarked, { type: "navigated" }), doc.key)).toEqual([]);
  expect(markedIds(reduce(waiting, { ...answer, selection: { kind: "skip" } }), doc.key)).toEqual([]);
  const all = reduce(waiting, { ...answer, selection: { kind: "keep-all" } });
  expect(markedIds(all, doc.key)).toEqual([id(2), id(1), id(3)]);
  expect(fadedIds(all, doc.key)).toEqual([]);
  expect(view(all)).toBe("faded");
  expect(view(reduce(all, { type: "hold-start" }))).toBe("revealed");
});
