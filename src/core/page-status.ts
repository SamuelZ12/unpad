import { candidates, marks, type PageState } from "./state";

export type NoContentHint = "open-post" | "none";

export type PageStatus =
  | { kind: "no-content"; hint: NoContentHint }
  | { kind: "reading" }
  | { kind: "cut"; lensOn: boolean; removed: number; marks: number }
  | { kind: "nothing-to-cut" }
  | { kind: "failed"; reason: string };

export function pageStatus(state: PageState, hint: NoContentHint | undefined): PageStatus {
  if (!state.docs.size) return hint === undefined ? { kind: "reading" } : { kind: "no-content", hint };
  let removed = 0;
  let marked = 0;
  let expanded = false;
  let waiting = false;
  let reason: string | undefined;
  for (const entry of state.docs.values()) {
    removed += candidates(entry).length;
    marked += marks(entry).length;
    expanded ||= entry.restored.size > 0;
    if (entry.picks.kind === "waiting") waiting = true;
    if (entry.picks.kind === "failed") reason ??= entry.picks.reason;
  }
  if (removed || marked || expanded) return { kind: "cut", lensOn: state.lensOn, removed, marks: marked };
  if (waiting) return { kind: "reading" };
  if (reason !== undefined) return { kind: "failed", reason };
  return { kind: "nothing-to-cut" };
}
