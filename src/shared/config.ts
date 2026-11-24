export const BRIDGE_URL = process.env.BRIDGE_URL ?? "http://127.0.0.1:18931";

export const MIN_SENTENCES = 6;
export const MAX_SENTENCES = 400;
export const MIN_FADED = 3;
export const MIN_MARK_SENTENCES = 20;
export const SENTENCES_PER_MARK = 10;
// An added site sends a page only when it has this many paragraphs of this many words.
export const MIN_ARTICLE_BLOCKS = 5;
export const MIN_BLOCK_WORDS = 40;
