import { fadedIds, markedIds, type PageState } from "../core/state";
import type { DocKey, SentenceId } from "../shared/types";
import type { AnchoredDoc } from "./anchor";
import { isEditing } from "./keys";

export function paintedAtPoint(
  document: Document, x: number, y: number, docs: readonly AnchoredDoc[], state: PageState,
): { type: "restore" | "unmark"; docKey: DocKey; id: SentenceId } | undefined {
  const caret = document.caretPositionFromPoint(x, y);
  if (!caret) return;
  const { offsetNode, offset } = caret;
  for (const { doc, root, ranges } of docs) {
    if (!root.contains(offsetNode)) continue;
    const marked = markedIds(state, doc.key);
    for (const id of [...fadedIds(state, doc.key), ...marked]) {
      const range = ranges[id - 1];
      if (range.comparePoint(offsetNode, offset) !== 0) continue;
      const inside = [...range.getClientRects()].some(({ left, top, right, bottom }) =>
        x >= left && x <= right && y >= top && y <= bottom);
      if (inside) return { type: marked.includes(id) ? "unmark" : "restore", docKey: doc.key, id };
    }
  }
}

export function listenForPaintClick(click: (x: number, y: number) => void) {
  const selected = () => document.getSelection()?.isCollapsed === false;
  let wasSelected = false;
  window.addEventListener("pointerdown", () => { wasSelected = selected(); }, true);
  window.addEventListener("click", (event) => {
    const endingSelection = wasSelected || selected();
    wasSelected = false;
    if (event.button !== 0 || endingSelection || isEditing(event) || event.composedPath().some((target) =>
      target instanceof Element && target.matches("a, [role=link]"))) return;
    click(event.clientX, event.clientY);
  }, true);
}
