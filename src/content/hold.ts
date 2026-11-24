import { isEditing } from "./keys";

const holdDelay = 200;

export function listenForHold(start: () => void, end: (heldMs: number) => void) {
  const down = new Set<string>();
  let shift: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let held = false;
  let pressedAt = 0;

  function reset() {
    shift = undefined;
    clearTimeout(timer);
    if (!held) return;
    held = false;
    end(performance.now() - pressedAt);
  }

  window.addEventListener("keydown", (event) => {
    if (event.repeat) return;
    down.add(event.code);
    if (shift) {
      if (event.code !== shift) reset();
      return;
    }
    if (event.key !== "Shift" || down.size !== 1 || event.altKey || event.ctrlKey ||
      event.metaKey || isEditing(event)) return;

    shift = event.code;
    pressedAt = performance.now();
    timer = setTimeout(() => {
      held = true;
      start();
    }, holdDelay);
  }, true);

  // Release needs DOM key-up events, which chrome.commands does not provide.
  window.addEventListener("keyup", ({ code }) => {
    down.delete(code);
    if (code === shift) reset();
  }, true);

  window.addEventListener("blur", () => {
    down.clear();
    reset();
  });
}
