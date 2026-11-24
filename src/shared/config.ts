export const BRIDGE_URL = process.env.BRIDGE_URL ?? "http://127.0.0.1:18931";

export const MIN_SENTENCES = 6;
// Measured Nov 24 2026: Pi's keep call took 8.6 s for 789 sentences, 14.2 s for 1,370 and 17.1 s for 2,008, against its 20 s timeout.
export const MAX_SENTENCES = 1500;
export const MIN_FADED = 3;
export const MIN_MARK_SENTENCES = 20;
export const MARK_CAP_MULTIPLIER = 2;

export function maxMarks(sentenceCount: number): number {
  return sentenceCount < MIN_MARK_SENTENCES ? 0 : Math.ceil(MARK_CAP_MULTIPLIER * Math.sqrt(sentenceCount));
}

// An added site sends a page only when it has this many paragraphs of this many words.
export const MIN_ARTICLE_BLOCKS = 5;
export const MIN_BLOCK_WORDS = 40;
