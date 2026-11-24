import { fadedIds, type PageState } from "../core/state";
import type { DocKey, SentenceId } from "../shared/types";
import type { AnchoredDoc } from "./anchor";

export function fadedAtPoint(
  document: Document, x: number, y: number, docs: readonly AnchoredDoc[], state: PageState,
): { docKey: DocKey; id: SentenceId } | undefined {
  const caret = document.caretPositionFromPoint(x, y);
  if (!caret) return;
  const { offsetNode, offset } = caret;
  for (const { doc, root, ranges } of docs) {
    if (!root.contains(offsetNode)) continue;
    for (const id of fadedIds(state, doc.key)) {
      const range = ranges[id - 1];
      if (range.comparePoint(offsetNode, offset) !== 0) continue;
      const inside = [...range.getClientRects()].some(({ left, top, right, bottom }) =>
        x >= left && x <= right && y >= top && y <= bottom);
      if (inside) return { docKey: doc.key, id };
    }
  }
}

export function listenForRestore(restore: (x: number, y: number) => void) {
  const selected = () => document.getSelection()?.isCollapsed === false;
  let wasSelected = false;
  window.addEventListener("pointerdown", () => { wasSelected = selected(); }, true);
  window.addEventListener("click", (event) => {
    const endingSelection = wasSelected || selected();
    wasSelected = false;
    if (event.button !== 0 || endingSelection || event.composedPath().some((target) =>
      target instanceof Element && target.matches("a, [role=link]"))) return;
    restore(event.clientX, event.clientY);
  }, true);
}
