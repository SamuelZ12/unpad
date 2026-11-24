import type { DocKey, SentenceId } from "../shared/types";
import { markerSelector } from "./cut";
import { isEditing } from "./keys";

export type Mark = { docKey: DocKey; id: SentenceId; range: Range };

export function listenForMarkClick(marks: () => readonly Mark[], unmark: (target: Mark) => void) {
  const selected = () => document.getSelection()?.isCollapsed === false;
  let wasSelected = false;
  window.addEventListener("pointerdown", () => { wasSelected = selected(); }, true);
  window.addEventListener("click", (event) => {
    const endingSelection = wasSelected || selected();
    wasSelected = false;
    // A key press on a button is a click at 0,0. Only a real pointer click counts.
    if (!event.isTrusted || event.detail === 0 || event.button !== 0 || endingSelection || isEditing(event) ||
      event.composedPath().some((target) => target instanceof Element && target.matches(`a, [role=link], ${markerSelector}`))) return;
    const { clientX: x, clientY: y } = event;
    const caret = document.caretPositionFromPoint(x, y);
    if (!caret) return;
    const { offsetNode, offset } = caret;
    const target = marks().find(({ range }) => range.isPointInRange(offsetNode, offset) &&
      [...range.getClientRects()].some(({ left, top, right, bottom }) =>
        x >= left && x <= right && y >= top && y <= bottom));
    if (target) unmark(target);
  }, true);
}
