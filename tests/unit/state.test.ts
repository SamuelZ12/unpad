import { expect, test } from "bun:test";
import { fadedIds, reduce, view, type PageState } from "../../src/core/state";
import type { CacheKey, Doc, DocKey, SentenceId } from "../../src/shared/types";

const id = (n: number) => n as SentenceId;
const doc: Doc = { key: "a" as DocKey, surface: "blog", title: "", sentences: ["a", "b", "c", "d", "e", "f"] };
const initial: PageState = { lensOn: true, holding: false, docs: new Map() };

test("the view is derived from waiting, picks, lens, hold and restores", () => {
  expect(view(initial)).toBe("idle");
  const waiting = reduce(initial, { type: "doc-found", doc });
  expect(view(waiting)).toBe("waiting");
  const answer = { type: "picks-arrived", docKey: doc.key, cacheKey: "b" as CacheKey, selection: { kind: "keep", keep: [id(1), id(2)] } } as const;
  expect(reduce(initial, answer)).toBe(initial);
  const faded = reduce(waiting, answer);
  expect(reduce(faded, { type: "doc-found", doc })).toBe(faded);
  expect(view(faded)).toBe("faded");
  expect(fadedIds(faded, doc.key)).toEqual([3, 4, 5, 6].map(id));
  const revealed = reduce(faded, { type: "hold-start" });
  expect(view(revealed)).toBe("revealed");
  expect(fadedIds(revealed, doc.key)).toEqual([]);
  const restored = reduce(reduce(revealed, { type: "hold-end" }), { type: "restore", docKey: doc.key, id: id(3) });
  expect(fadedIds(restored, doc.key)).toEqual([4, 5, 6].map(id));
  const off = reduce(restored, { type: "lens-set", on: false });
  expect(view(off)).toBe("picks-ready");
  expect(fadedIds(off, doc.key)).toEqual([]);
  expect(view(reduce(off, { type: "navigated" }))).toBe("idle");
  expect(view(reduce(waiting, { ...answer, selection: { kind: "keep-all" } }))).toBe("idle");
  expect(view(reduce(waiting, { type: "picks-failed", docKey: doc.key, reason: "Offline" }))).toBe("idle");
});
