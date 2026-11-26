import { TOGGLE_COMMAND } from "./config";

export const SHORTCUT_SETTINGS = "chrome://extensions/shortcuts";

export async function assignedShortcut() {
  const key = (await chrome.commands.getAll()).find(({ name }) => name === TOGGLE_COMMAND)?.shortcut;
  if (!key || !navigator.platform.startsWith("Mac")) return key;
  const symbols: Record<string, string> = { Alt: "⌥", MacCtrl: "⌃", Ctrl: "⌃", Shift: "⇧", Command: "⌘", Meta: "⌘" };
  return key.split("+").map((part) => symbols[part] ?? part).join("");
}
