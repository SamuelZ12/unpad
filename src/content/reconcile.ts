import { markedIds, removedRuns, restoredRuns, type PageState, type RunEvent } from "../core/state";
import { rangeOf, type AnchoredDoc, type SentenceAnchor } from "./anchor";
import { createCut, firstRect } from "./cut";
import { createMarkPainter } from "./paint";

type Pin = { sentence: SentenceAnchor; top: number };
type RunAction = Pin & { event: RunEvent };

function sameAnchors(a: AnchoredDoc, b: AnchoredDoc) {
  return a === b || a.root === b.root && a.doc.key === b.doc.key &&
    a.sentences.every(({ block, slices }, i) => {
      const other = b.sentences[i];
      return block === other.block && slices.length === other.slices.length &&
        slices.every(({ node, start, end }, j) => {
          const next = other.slices[j];
          return node === next.node && start === next.start && end === next.end;
        });
    });
}

export function createProjection(toggleRun: (action: RunAction) => void) {
  const cut = createCut((event, sentence, top) => toggleRun({ event, sentence, top }));
  let paintMarks: ReturnType<typeof createMarkPainter> | undefined;
  let layout: readonly AnchoredDoc[] = [];
  let applied = "";
  let hadRuns = false;
  let markKey = "";

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
    reconcile(docs: readonly AnchoredDoc[], state: PageState, action?: RunAction) {
      const next = docs.map(({ doc, sentences }) => ({
        docKey: doc.key, sentences, removed: removedRuns(state, doc.key), restored: restoredRuns(state, doc.key),
      }));
      const key = JSON.stringify(next.map(({ removed, restored }) => [removed, restored]));
      const same = docs.length === layout.length && docs.every((doc, i) => sameAnchors(doc, layout[i]));
      const changed = !same || key !== applied || cut.dirty;
      let control: HTMLElement | undefined;
      if (changed) {
        const hasRuns = next.some(({ removed, restored }) => removed.length || restored.length);
        let pin: Pin | undefined = action;
        if (action?.event.type !== "restore" && (hadRuns || hasRuns)) {
          pin = readingPin(docs, state) ?? action;
        }
        const focus = action ?? cut.focusedRun();
        cut.clear();
        cut.apply(next);
        control = focus && cut.control(focus.sentence, focus.event);
        if (pin) {
          const rect = firstRect(pin.sentence, cut.locate) ??
            (pin === action ? control?.getBoundingClientRect() : undefined);
          if (rect?.width) window.scrollTo({ top: Math.round(window.scrollY + rect.top - pin.top), behavior: "instant" });
        }
        layout = docs;
        applied = key;
        hadRuns = hasRuns;
      }

      const ids = docs.map(({ doc }) => markedIds(state, doc.key));
      const marks = JSON.stringify(ids);
      if (changed || marks !== markKey) {
        markKey = marks;
        const ranges = docs.flatMap(({ sentences }, i) => ids[i].flatMap((id) => rangeOf(sentences[id - 1], cut.locate) ?? []));
        if (ranges.length) (paintMarks ??= createMarkPainter())(ranges);
        else paintMarks?.([]);
      }
      return control;
    },
  };
}
