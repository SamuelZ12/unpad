import type { CacheKey, Doc, DocKey, Selection, SentenceId } from "../shared/types";

export type Picks =
  | { readonly kind: "waiting" }
  | { readonly kind: "ready"; readonly cacheKey: CacheKey; readonly selection: Selection; readonly key: readonly SentenceId[] }
  | { readonly kind: "failed"; readonly reason: string };

export interface DocState {
  readonly doc: Doc;
  readonly picks: Picks;
  readonly restored: ReadonlySet<SentenceId>;
  readonly unmarked: ReadonlySet<SentenceId>;
}

export interface PageState {
  readonly lensOn: boolean;
  readonly holding: boolean;
  readonly docs: ReadonlyMap<DocKey, DocState>;
}

export type PageEvent =
  | { readonly type: "lens-set"; readonly on: boolean }
  | { readonly type: "doc-found"; readonly doc: Doc }
  | { readonly type: "picks-arrived"; readonly docKey: DocKey; readonly cacheKey: CacheKey; readonly selection: Selection; readonly key?: readonly SentenceId[] }
  | { readonly type: "picks-failed"; readonly docKey: DocKey; readonly reason: string }
  | { readonly type: "hold-start" }
  | { readonly type: "hold-end" }
  | { readonly type: "restore"; readonly docKey: DocKey; readonly ids: readonly SentenceId[] }
  | { readonly type: "unmark"; readonly docKey: DocKey; readonly id: SentenceId }
  | { readonly type: "navigated" };

export type View = "idle" | "waiting" | "picks-ready" | "faded" | "revealed";

export function candidates(entry: DocState): SentenceId[] {
  if (entry.picks.kind !== "ready" || entry.picks.selection.kind !== "keep") return [];
  const keep = new Set(entry.picks.selection.keep);
  return entry.doc.sentences.map((_, index) => (index + 1) as SentenceId)
    .filter((id) => !keep.has(id) && !entry.restored.has(id));
}

export function fadedIds(state: PageState, docKey: DocKey): readonly SentenceId[] {
  const entry = state.docs.get(docKey);
  return state.lensOn && !state.holding && entry ? candidates(entry) : [];
}

export function removedRuns(state: PageState, docKey: DocKey): SentenceId[][] {
  const runs: SentenceId[][] = [];
  for (const id of fadedIds(state, docKey)) {
    const run = runs.at(-1);
    if (run && id === run.at(-1)! + 1) run.push(id);
    else runs.push([id]);
  }
  return runs;
}

export function marks(entry: DocState): readonly SentenceId[] {
  return entry.picks.kind === "ready" ? entry.picks.key.filter((id) => !entry.unmarked.has(id)) : [];
}

export function markedIds(state: PageState, docKey: DocKey): readonly SentenceId[] {
  const entry = state.docs.get(docKey);
  return state.lensOn && !state.holding && entry ? marks(entry) : [];
}

// Derive the view so the lens, hold, and per-doc picks cannot disagree with it.
export function view(state: PageState): View {
  const docs = [...state.docs.values()];
  if (docs.some((entry) => candidates(entry).length || marks(entry).length)) {
    if (!state.lensOn) return "picks-ready";
    return state.holding ? "revealed" : "faded";
  }
  return docs.some((entry) => entry.picks.kind === "waiting") ? "waiting" : "idle";
}

export function reduce(state: PageState, event: PageEvent): PageState {
  switch (event.type) {
    case "lens-set": return { ...state, lensOn: event.on };
    case "hold-start": return { ...state, holding: true };
    case "hold-end": return { ...state, holding: false };
    case "navigated": return { ...state, holding: false, docs: new Map() };
    case "doc-found": {
      const { doc } = event;
      if (state.docs.has(doc.key)) return state;
      const entry: DocState = { doc, picks: { kind: "waiting" }, restored: new Set(), unmarked: new Set() };
      return { ...state, docs: new Map(state.docs).set(doc.key, entry) };
    }
  }

  const entry = state.docs.get(event.docKey);
  if (!entry) return state;
  let next: DocState;
  switch (event.type) {
    case "picks-arrived": {
      if (entry.picks.kind !== "waiting") return state;
      const { selection, cacheKey } = event;
      const keep = selection.kind === "keep" ? new Set(selection.keep) : undefined;
      const key = selection.kind === "skip" ? [] : (event.key ?? [])
        .filter((id) => id <= entry.doc.sentences.length && (!keep || keep.has(id)));
      next = { ...entry, picks: { kind: "ready", cacheKey, selection, key } };
      break;
    }
    case "picks-failed":
      if (entry.picks.kind !== "waiting") return state;
      next = { ...entry, picks: { kind: "failed", reason: event.reason } };
      break;
    case "restore": {
      const run = removedRuns(state, event.docKey).find((ids) =>
        ids.length === event.ids.length && ids.every((id, i) => id === event.ids[i]));
      if (!run) return state;
      next = { ...entry, restored: new Set([...entry.restored, ...run]) };
      break;
    }
    case "unmark":
      if (!markedIds(state, event.docKey).includes(event.id)) return state;
      next = { ...entry, unmarked: new Set(entry.unmarked).add(event.id) };
      break;
  }
  return { ...state, docs: new Map(state.docs).set(event.docKey, next) };
}
