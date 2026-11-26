import { candidates, marks, type DocState, type PageState } from "./state";

export type PageStatus =
  | { kind: "reading" }
  | { kind: "cut"; lensOn: boolean; removed: number; marks: number }
  | { kind: "nothing-to-cut" }
  | { kind: "failed"; reason: string };

export function pageStatus(
  state: PageState, scanned: boolean, mounted: Iterable<DocState> = state.docs.values(),
): PageStatus {
  if (!scanned) return { kind: "reading" };
  let removed = 0;
  let marked = 0;
  let expanded = false;
  let waiting = false;
  let reason: string | undefined;
  for (const entry of mounted) {
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
