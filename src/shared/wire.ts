import { MAX_SENTENCES, MIN_SENTENCES } from "./config";
import type { CacheKey, LogEvent, RulesVersion, Selection, SelectorVersion, SentenceId } from "./types";

export interface SelectRequest {
  readonly title: string;
  readonly sentences: readonly string[];
}

export interface SelectResponse {
  readonly cacheKey: CacheKey;
  readonly selection: Selection;
}

export interface ErrorResponse {
  readonly error: string;
}

export interface EventsRequest {
  readonly events: readonly LogEvent[];
}

export interface EventsResponse {
  readonly accepted: number;
}

export interface HealthResponse {
  readonly selectorVersion: SelectorVersion;
  readonly rulesVersion: RulesVersion;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCacheKey(value: unknown): value is CacheKey {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function isVersion(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{12}$/.test(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isSentenceId(value: unknown): value is SentenceId {
  return isCount(value) && value > 0 && value <= MAX_SENTENCES;
}

function isSelection(value: unknown): value is Selection {
  if (!isRecord(value)) return false;
  if (value.kind === "keep-all") return true;
  return value.kind === "keep" && Array.isArray(value.keep)
    && value.keep.length > 0 && value.keep.every(isSentenceId)
    && new Set(value.keep).size === value.keep.length;
}

function isLogEvent(value: unknown): value is LogEvent {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.at !== "string"
    || typeof value.pageView !== "string" || typeof value.url !== "string") return false;

  switch (value.type) {
    case "shown":
      return isCacheKey(value.cacheKey) && isCount(value.total) && isCount(value.faded)
        && value.faded <= value.total;
    case "restore":
      return isCacheKey(value.cacheKey) && isSentenceId(value.sentenceId)
        && typeof value.text === "string";
    case "reveal":
      return typeof value.heldMs === "number" && Number.isFinite(value.heldMs) && value.heldMs >= 0;
    default:
      return false;
  }
}

export function parseSelectRequest(value: unknown): SelectRequest | undefined {
  if (!isRecord(value) || typeof value.title !== "string" || !Array.isArray(value.sentences)
    || value.sentences.length < MIN_SENTENCES || value.sentences.length > MAX_SENTENCES
    || !value.sentences.every((sentence) => typeof sentence === "string")) return undefined;
  return { title: value.title, sentences: value.sentences };
}

export function parseSelectResponse(value: unknown): SelectResponse | undefined {
  if (!isRecord(value) || !isCacheKey(value.cacheKey) || !isSelection(value.selection)) return undefined;
  return { cacheKey: value.cacheKey, selection: value.selection };
}

export function parseErrorResponse(value: unknown): ErrorResponse | undefined {
  if (!isRecord(value) || typeof value.error !== "string") return undefined;
  return { error: value.error };
}

export function parseEventsRequest(value: unknown): EventsRequest | undefined {
  if (!isRecord(value) || !Array.isArray(value.events) || !value.events.every(isLogEvent)) return undefined;
  return { events: value.events };
}

export function parseEventsResponse(value: unknown): EventsResponse | undefined {
  if (!isRecord(value) || !isCount(value.accepted)) return undefined;
  return { accepted: value.accepted };
}

export function parseHealthResponse(value: unknown): HealthResponse | undefined {
  if (!isRecord(value) || !isVersion(value.selectorVersion) || !isVersion(value.rulesVersion)) return undefined;
  return {
    selectorVersion: value.selectorVersion as SelectorVersion,
    rulesVersion: value.rulesVersion as RulesVersion,
  };
}
