function isEditor(target: EventTarget | null) {
  return target instanceof HTMLElement &&
    (target.isContentEditable || target.matches("input, textarea, select"));
}

export function isEditing(event: KeyboardEvent) {
  return event.composedPath().some(isEditor);
}

export function hasFocusedEditor() {
  let target = document.activeElement;
  while (target?.shadowRoot?.activeElement) target = target.shadowRoot.activeElement;
  // The top-frame listener could not receive keys from an embedded document.
  return isEditor(target) || target?.matches("iframe, frame") === true;
}

export function isToggle(event: KeyboardEvent) {
  return event.code === "KeyF" && event.altKey && event.shiftKey &&
    !event.ctrlKey && !event.metaKey && !event.repeat && !isEditing(event);
}

export function listenForToggle(toggle: () => false | void) {
  window.addEventListener("keydown", (event) => {
    if (!event.isTrusted || !isToggle(event) || toggle() === false) return;
    event.preventDefault();
  }, true);
}
