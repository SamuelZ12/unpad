# filler-cut v0 data shape

This file names the data that v0 passes around and says which part of the system owns each piece. `docs/spec.md` states the behaviour. `docs/plan.md` orders the build.

The measurements cited here come from throwaway prototypes run on Nov 23 2026. The scripts and results are in `~/.pi/agent/filler-cut/v0-plan-proto/` on the Mini, with a summary in `FINDINGS.md`.

## Systems the change touches

| System | Role | State it owns |
| --- | --- | --- |
| Page DOM | Holds the author's text. X's logged-in app removes and rebuilds posts as you scroll. | The text |
| Content script | Finds docs, asks for picks, paints fades, handles keys and clicks. | `PageState`, in memory, per tab |
| Service worker | Makes the HTTPS calls that a content script cannot make. Chrome stops it when idle. | Nothing in memory. A queue of unsent log events in `chrome.storage.local` |
| `chrome.storage.local` | Shared by all tabs. | `lensOn`, `enabledOrigins`, `pendingEvents` |
| Bridge on the Mini | HTTP server behind `tailscale serve`. Runs Pi, checks its answer, caches it, appends log events. | The picks cache, `events.jsonl`, the request log |
| Pi | `pi -p` with Claude Opus 5.5, thinking off, no tools. | Nothing |
| Reader-rules file | Text compiled from Samuel's memory. Read by the bridge. | Samuel's reading preferences |

## The types

```ts
// src/shared/types.ts
declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

/** 1-based position of a sentence inside one Doc. */
export type SentenceId = Brand<number, "SentenceId">;
/** sha256 hex of the Doc's title and sentence texts. */
export type DocKey = Brand<string, "DocKey">;
/** sha256 hex of selector version, rules version, and DocKey. */
export type CacheKey = Brand<string, "CacheKey">;
export type SelectorVersion = Brand<string, "SelectorVersion">;
export type RulesVersion = Brand<string, "RulesVersion">;

export type Surface = "x-post" | "x-article" | "blog";

/** Plain data. This is what the bridge receives. */
export interface Doc {
	readonly key: DocKey;
	readonly surface: Surface;
	/** The article or page title. Empty for an X post. Never faded. */
	readonly title: string;
	/** sentences[i] has SentenceId i + 1. Each string is page text with whitespace collapsed. */
	readonly sentences: readonly string[];
}

/** The selector's answer for one Doc, after the bridge has checked it. */
export type Selection =
	| { readonly kind: "keep-all" }
	| { readonly kind: "keep"; readonly keep: readonly SentenceId[] };
```

```ts
// src/content/anchor.ts
/** A Doc tied to live DOM nodes. Never stored or sent. Rebuilt whenever the DOM changes. */
export interface AnchoredDoc {
	readonly doc: Doc;
	readonly root: Element;
	/** ranges[i] covers sentences[i]. */
	readonly ranges: readonly Range[];
}
```

```ts
// src/core/state.ts
export type Picks =
	| { readonly kind: "waiting" }
	| { readonly kind: "ready"; readonly cacheKey: CacheKey; readonly selection: Selection }
	| { readonly kind: "failed"; readonly reason: string };

export interface DocState {
	readonly doc: Doc;
	readonly picks: Picks;
	readonly restored: ReadonlySet<SentenceId>;
}

export interface PageState {
	readonly lensOn: boolean;
	readonly holding: boolean;
	readonly docs: ReadonlyMap<DocKey, DocState>;
}

export type PageEvent =
	| { readonly type: "lens-set"; readonly on: boolean }
	| { readonly type: "doc-found"; readonly doc: Doc }
	| { readonly type: "picks-arrived"; readonly docKey: DocKey; readonly cacheKey: CacheKey; readonly selection: Selection }
	| { readonly type: "picks-failed"; readonly docKey: DocKey; readonly reason: string }
	| { readonly type: "hold-start" }
	| { readonly type: "hold-end" }
	| { readonly type: "restore"; readonly docKey: DocKey; readonly id: SentenceId }
	| { readonly type: "navigated" };

export function reduce(state: PageState, event: PageEvent): PageState;

/** The sentences the painter fades right now. Empty unless the lens is on, no key is held, and picks are ready. */
export function fadedIds(state: PageState, docKey: DocKey): readonly SentenceId[];

export type View = "idle" | "waiting" | "picks-ready" | "faded" | "revealed";
export function view(state: PageState): View;
```

```ts
// src/shared/types.ts
export type LogEvent =
	| { readonly type: "shown"; readonly id: string; readonly at: string; readonly pageView: string; readonly url: string; readonly cacheKey: CacheKey; readonly total: number; readonly faded: number }
	| { readonly type: "restore"; readonly id: string; readonly at: string; readonly pageView: string; readonly url: string; readonly cacheKey: CacheKey; readonly sentenceId: SentenceId; readonly text: string }
	| { readonly type: "reveal"; readonly id: string; readonly at: string; readonly pageView: string; readonly url: string; readonly heldMs: number };
```

## Sentence spans

A sentence is a string plus its position in the doc. In the DOM a sentence is a `Range`. The extension adds no element and no attribute inside the doc, so the page text cannot change and the layout cannot move.

`extract(document, url)` returns the `AnchoredDoc` list for the page. It is the only code that reads the DOM for text. It works in three steps:

1. A surface table maps the page to doc roots and to the text blocks inside each root. The table has one row for each surface on each frontend: the X app, the logged-out X page, and a generic blog page.
2. `segment(blockText)` splits one block into sentences. It is a pure function. It starts from `Intl.Segmenter` and then applies fixed corrections. One correction is known: `Intl.Segmenter` keeps "…open source. 155 today, in 36 projects." as one sentence.
3. Each sentence gets a `Range` across the block's text nodes.

A doc with fewer than `MIN_SENTENCES` (6) or more than `MAX_SENTENCES` (400) sentences is dropped here. No dropped doc reaches the bridge.

## The selection

Pi answers with keep ids. The bridge is the only code that reads Pi's raw output. `parseSelection(raw, sentenceCount)` returns a `Selection` or an error:

- `"ALL"` becomes `keep-all`.
- A JSON array of integers, or of digit strings, becomes `keep`. In 2 of 15 prototype runs Pi returned digit strings.
- An id outside `1..sentenceCount`, a repeated id, an empty array, or any other text is an error. The bridge retries once. A second error fails the request, and the page stays untouched.
- A `keep` that would fade fewer than `MIN_FADED` (3) sentences becomes `keep-all`. This rule keeps dense posts untouched. Over 5 runs each, Pi faded 0 or 1 of Perfloop's 10 sentences and 4 to 7 of Wang's 29.

The page text is untrusted input to Pi. Pi has no tools, and the bridge accepts only ids from its answer. The worst result of a hostile page is a bad set of picks.

## The cache key

```
selectorVersion = first 12 hex of sha256(prompt template, model id, Pi flags, MIN_FADED, parser version)
rulesVersion    = first 12 hex of sha256(reader-rules file bytes)
docKey          = sha256(JSON of [title, ...sentences])
cacheKey        = sha256(selectorVersion + ":" + rulesVersion + ":" + docKey)
```

The bridge owns the cache. One file per key, `cache/<cacheKey>.json`, written to a temporary name and renamed into place. The file holds the versions, the title, the sentences, the `Selection`, Pi's raw answer, and the elapsed time. A miss event carries only the `cacheKey`, and the report reads the sentences and the picks from the cache file.

The extension keeps no cache on disk. A revisit costs one HTTPS round trip to the bridge. Two requests for the same key that overlap share one Pi call.

`src/shared/keys.ts` computes `DocKey`. The extension calls it to key `PageState.docs`. The bridge calls the same function on the request body and never trusts a key sent by a client.

## The page state

`PageState` stores facts. The four states that Samuel sees are computed from the facts by `view()`:

| `view()` | When |
| --- | --- |
| `revealed` | The lens is on, the key is held, and at least one doc has a sentence to fade. |
| `faded` | The lens is on, no key is held, and at least one doc has a sentence to fade. |
| `picks-ready` | The lens is off and at least one doc has a sentence to fade. |
| `waiting` | No doc has a sentence to fade and at least one doc has `picks.kind === "waiting"`. |
| `idle` | Everything else: no doc, only `keep-all` picks, only failed picks, or every pick restored. |

A doc "has a sentence to fade" when its picks are `ready`, its selection is `keep`, and at least one sentence is neither kept nor restored.

The content script is a thin shell around `reduce`:

- A `MutationObserver` and URL changes trigger `extract`. Each new `DocKey` dispatches `doc-found` and sends one request to the service worker.
- The answer dispatches `picks-arrived` or `picks-failed` for that `DocKey`. An answer for a doc that has left the page updates only that doc's entry.
- After every dispatch, `paint(anchoredDocs, state)` replaces the contents of one CSS Custom Highlight with the ranges of `fadedIds`. `paint` builds everything from the current DOM and the current state, so calling it twice gives the same result as calling it once.
- `lensOn` lives in `chrome.storage.local`. The toggle key writes it. Every tab receives `storage.onChanged` and dispatches `lens-set`.

X's logged-in app removed the Wang article from the DOM when the page was scrolled into the replies, and built new nodes on the way back. All 14 test ranges were dead after the round trip, and the text was identical. The state therefore lives under `DocKey`, not on DOM nodes. When the post returns, `extract` finds the same `DocKey` and `paint` fades the same sentences. Rebuilding 28 ranges took 0.3 ms.

## The miss log

A miss is a `restore` event. The content script creates log events and gives them to the service worker. The service worker posts them to the bridge and keeps unsent events in `pendingEvents`. The bridge appends each event as one line to `events.jsonl`.

The `id` of a `shown` or `restore` event is a hash of the page view, the type, the `cacheKey`, and the sentence id. A repeated delivery has the same `id`, and the report counts each `id` once.

`bun run report` reads `events.jsonl` and the cache. It prints the miss rate, which is restored sentences divided by faded sentences shown. It lists each restored sentence with its page, and it counts reveals per page.

## The wire format

```
POST /select   { title: string, sentences: string[] }
               200 { cacheKey, selection }
               502 { error }
POST /events   { events: LogEvent[] }
               200 { accepted: number }
GET  /health   200 { selectorVersion, rulesVersion }
```

`src/shared/wire.ts` holds one parse function per message. Each side parses what it receives and trusts the typed value after that.

## Choices and the shapes they beat

### Facts and a derived view, not a four-state machine

A state machine with the states `waiting`, `picks-ready`, `faded`, and `revealed` needs side data at once: whether the lens was switched on during `waiting`, which sentences are restored, and a separate copy per post on an X thread. The side data can then disagree with the state name, for example `faded` with no picks. With facts and `view()`, each fact has one writer and `faded` without picks cannot be expressed.

### Ranges and the CSS Custom Highlight API, not wrapper elements

Wrapping each sentence in an element would give real click targets and richer effects. It would also write into a DOM that React owns, and it would add nodes that can move text. Ranges change only paint. In the prototype the kept sentence's top was 327 px before and after the fade. The costs are a hit test for clicks, which `document.caretPositionFromPoint` handled in the prototype, and colour-only styling.

### An HTTP bridge behind `tailscale serve`, not a native messaging host with ssh

Both worked from an extension service worker in Chromium 159. An echo round trip took 1.0 to 1.2 ms over HTTPS and 31.7 to 31.9 ms through a native host, at 20 calls per cell. The native host also needs a manifest and a script installed on every machine, and ssh trust between the machines. The ssh hop was not measured. Pi also hung for 60 s under the native host until its standard input pointed at `/dev/null`. The HTTP bridge needs one URL in the extension. A hosted selector can replace it later by changing that URL. The Mini already serves three other local ports the same way.

### The bridge owns the cache, not the extension

An extension cache would save one round trip per revisit. It would also need the rules version, which only the bridge knows, and the report would need a second copy of the sentences.

### Keys handled in the content script, not `chrome.commands`

The reveal key needs a key-up event, which `chrome.commands` does not deliver. Keeping the toggle key in the same listener gives one place for key handling. It also lets an agent press the key: synthetic key events reached a content script in the prototype and did not fire `chrome.commands`.
