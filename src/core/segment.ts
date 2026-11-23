const sentenceSegmenter = new Intl.Segmenter("en", { granularity: "sentence" });

export interface Span {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export function collapse(text: string) {
  return text.replace(/\s+/gu, " ").trim();
}

export function segment(text: string): Span[] {
  const boundaries = new Set<number>([0, text.length]);
  for (const { index } of sentenceSegmenter.segment(text)) boundaries.add(index);
  // ICU treats a period immediately before a number as part of the sentence.
  for (const match of text.matchAll(/\p{L}[.!?]\s+(?=\d+\s+\p{L})/gu)) {
    boundaries.add(match.index + match[0].length);
  }

  const quoted = [...text.matchAll(/“[^”]*”|"[^"\n]*"/gu)];
  const cuts = [...boundaries].sort((a, b) => a - b).filter((index) =>
    index === 0 || index === text.length ||
    (!/\b(?:e\.g\.|i\.e\.|etc\.)\s*$/iu.test(text.slice(Math.max(0, index - 12), index)) &&
      !quoted.some((match) => index > match.index && index < match.index + match[0].length)));

  return cuts.slice(1).flatMap((end, index) => {
    const raw = text.slice(cuts[index], end);
    const trimmed = raw.trim();
    if (!trimmed) return [];
    const start = cuts[index] + raw.length - raw.trimStart().length;
    return [{ start, end: start + trimmed.length, text: collapse(raw) }];
  });
}
