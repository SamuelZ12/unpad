import { markedIds, removedRuns, type PageState } from "../core/state";
import type { DocKey, SentenceId } from "../shared/types";
import { rangeOf, type AnchoredDoc, type SentenceAnchor } from "./anchor";
import type { Mark } from "./click";
import { createCut, firstRect } from "./cut";
import { createMarkPainter } from "./paint";

type Pin = { sentence: SentenceAnchor; top: number };

function sameAnchors(a: AnchoredDoc, b: AnchoredDoc) {
  return a.root === b.root && a.doc.key === b.doc.key &&
    a.sentences.every(({ block, slices }, i) => {
      const other = b.sentences[i];
      return block === other.block && slices.length === other.slices.length &&
        slices.every(({ node, start, end }, j) => {
          const next = other.slices[j];
          return node === next.node && start === next.start && end === next.end;
        });
    });
}

export function createProjection(expand: (docKey: DocKey, ids: readonly SentenceId[], pin: Pin) => void) {
  const cut = createCut((docKey, ids, sentence, marker) =>
    expand(docKey, ids, { sentence, top: marker.getBoundingClientRect().top }));
  const paintMarks = createMarkPainter();
  let layout: readonly AnchoredDoc[] = [];
  let applied = "";
  let hadCuts = false;
  let markKey = "";
  let visibleMarks: Mark[] = [];

  function readingPin(docs: readonly AnchoredDoc[], state: PageState): Pin | undefined {
    const topEdge = Math.min(window.innerHeight / 3, 180);
    let best: Pin | undefined;
    let distance = Infinity;
    for (const { doc, sentences } of docs) {
      const removed = new Set(removedRuns(state, doc.key).flat().map(Number));
      for (let i = 0; i < sentences.length; i++) {
        if (removed.has(i + 1)) continue;
        const sentence = sentences[i];
        const rect = firstRect(sentence, cut.locate);
        if (!rect || rect.bottom <= 0 || rect.top >= window.innerHeight || !rect.width) continue;
        const next = Math.abs(rect.top - topEdge);
        if (next >= distance) continue;
        best = { sentence, top: rect.top };
        distance = next;
      }
    }
    return best;
  }

  return {
    read: cut.read,
    onMutations: cut.onMutations,
    marks: () => visibleMarks,
    reconcile(docs: readonly AnchoredDoc[], state: PageState, pin?: Pin) {
      const next = docs.map(({ doc, sentences }) => ({ docKey: doc.key, sentences, runs: removedRuns(state, doc.key) }));
      const key = JSON.stringify(next.map(({ runs }) => runs));
      const same = docs.length === layout.length && docs.every((doc, i) => sameAnchors(doc, layout[i]));
      const changed = !same || key !== applied || cut.dirty;
      if (changed) {
        const hasCuts = next.some(({ runs }) => runs.length > 0);
        if (hadCuts || hasCuts) {
          pin ??= readingPin(docs, state);
        }
        cut.clear();
        cut.apply(next);
        if (pin) {
          const rect = firstRect(pin.sentence, cut.locate);
          if (rect?.width) window.scrollTo({ top: Math.round(window.scrollY + rect.top - pin.top), behavior: "instant" });
        }
        layout = docs;
        applied = key;
        hadCuts = hasCuts;
      }

      const ids = docs.map(({ doc }) => markedIds(state, doc.key));
      const marks = JSON.stringify(ids);
      if (changed || marks !== markKey) {
        markKey = marks;
        visibleMarks = docs.flatMap(({ doc, sentences }, i) => ids[i].flatMap((id) => {
          const range = rangeOf(sentences[id - 1], cut.locate);
          return range ? [{ docKey: doc.key, id, range }] : [];
        }));
        paintMarks(visibleMarks.map(({ range }) => range));
      }
    },
  };
}
