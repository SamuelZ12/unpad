export function isEditing(event: KeyboardEvent) {
  return event.composedPath().some((target) =>
    target instanceof HTMLElement &&
    (target.isContentEditable || target.matches("input, textarea, select")));
}

export function isToggle(event: KeyboardEvent) {
  return event.code === "KeyF" && event.altKey && event.shiftKey &&
    !event.ctrlKey && !event.metaKey && !event.repeat && !isEditing(event);
}

export function listenForToggle(toggle: () => void) {
  window.addEventListener("keydown", (event) => {
    if (!isToggle(event)) return;
    event.preventDefault();
    toggle();
  }, true);
}
