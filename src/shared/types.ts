declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

/** 1-based position of a sentence inside one Doc. */
export type SentenceId = Brand<number, "SentenceId">;
/** sha256 hex of the Doc's title and sentence texts. */
export type DocKey = Brand<string, "DocKey">;
/** sha256 hex of selector version, rules version, DocKey, and optional check URL. */
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
	| { readonly kind: "skip" }
	| { readonly kind: "keep-all" }
	| { readonly kind: "keep"; readonly keep: readonly SentenceId[] };

type SentenceClickEvent<T extends "restore" | "recut" | "unmark"> = {
	readonly type: T; readonly id: string; readonly at: string; readonly pageView: string; readonly url: string;
	readonly cacheKey: CacheKey; readonly sentenceId: SentenceId; readonly text: string;
};

export type LogEvent =
	| { readonly type: "shown"; readonly id: string; readonly at: string; readonly pageView: string; readonly url: string; readonly cacheKey: CacheKey; readonly total: number; readonly faded: number; readonly marks?: number }
	| SentenceClickEvent<"restore">
	| SentenceClickEvent<"recut">
	/** 0.3.1 and older logged a click on a mark. Kept so their batches and old log rows still parse. */
	| SentenceClickEvent<"unmark">
	| { readonly type: "reveal"; readonly id: string; readonly at: string; readonly pageView: string; readonly url: string; readonly heldMs: number };
