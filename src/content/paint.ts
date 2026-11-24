import { fadedIds, type PageState } from "../core/state";
import type { AnchoredDoc } from "./anchor";

const name = "filler-cut";
const alphaProperty = "--filler-cut-alpha";
const opacity = 0.4;
const duration = 160;
const rootSelectors = [
  "[data-article-body-html]",
  "[data-testid=twitterArticleRichTextView]",
  "[data-testid=tweetText]",
  ".text-rich-text--article",
  "div[dir=auto][lang]",
];

export function fadedRanges(docs: readonly AnchoredDoc[], state: PageState) {
  return docs.flatMap(({ doc, ranges }) => fadedIds(state, doc.key).map((id) => ranges[id - 1]));
}

function originatingElements(ranges: readonly Range[]) {
  const elements = new Set<Element>();
  for (const range of ranges) {
    const root = range.commonAncestorContainer;
    if (root.nodeType === Node.TEXT_NODE) {
      if (root.parentElement) elements.add(root.parentElement);
      continue;
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement && range.intersectsNode(node)) elements.add(node.parentElement);
    }
  }
  return elements;
}

function highlightStyles(ranges: readonly Range[]) {
  const selectors = new Map<Element, string>();
  function selector(element: Element): string {
    const known = selectors.get(element);
    if (known) return known;
    const root = rootSelectors.find((candidate) => element.matches(candidate));
    if (root) return root;
    if (element.id && document.getElementById(element.id) === element) return `#${CSS.escape(element.id)}`;
    const parent = element.parentElement;
    if (!parent) return ":root";
    const index = Array.prototype.indexOf.call(parent.children, element) + 1;
    const path = `${selector(parent)}> :nth-child(${index})`;
    selectors.set(element, path);
    return path;
  }

  const byColor = new Map<string, string[]>();
  for (const element of originatingElements(ranges)) {
    const { color } = getComputedStyle(element);
    const paths = byColor.get(color) ?? [];
    paths.push(selector(element));
    byColor.set(color, paths);
  }
  return [...byColor].map(([color, paths]) =>
    `:is(${paths.join(",")})::highlight(${name}){color:color-mix(in srgb,${color} calc(var(${alphaProperty}) * 100%),transparent)}`,
  ).join("\n");
}

export function createPainter() {
  const animation = new CSSStyleSheet();
  animation.replaceSync(`:root { ${alphaProperty}: 1 }`);
  const colors = new CSSStyleSheet();
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, animation, colors];
  const rule = animation.cssRules[0] as CSSStyleRule;
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  // The highlight paints ranges in place and leaves the site's DOM and layout intact.
  const highlight = new Highlight();
  CSS.highlights.set(name, highlight);
  let frame = 0;
  let alpha = 1;
  let target = 1;
  let styles = "";
  let active: Range[] = [];

  function updateStyles(ranges: readonly Range[]) {
    const next = highlightStyles(ranges);
    if (styles === next) return;
    styles = next;
    colors.replaceSync(styles);
  }

  function color(value: number) {
    alpha = value;
    rule.style.setProperty(alphaProperty, String(alpha));
  }

  function finish() {
    color(target);
    if (target !== 1) return;
    highlight.clear();
    active = [];
    updateStyles(active);
  }

  motion.addEventListener("change", () => {
    if (!motion.matches) return;
    cancelAnimationFrame(frame);
    finish();
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => updateStyles(active));

  return function paint(docs: readonly AnchoredDoc[], state: PageState, animate = true) {
    const ranges = fadedRanges(docs, state);
    // Restoring one sentence should only invalidate the pixels of that range.
    if (!animate && ranges.length && ranges.length < active.length && ranges.every((range) => highlight.has(range))) {
      const remaining = new Set(ranges);
      for (const range of active) if (!remaining.has(range)) highlight.delete(range);
      active = ranges;
      return;
    }
    if (ranges.length) {
      updateStyles(ranges);
      highlight.clear();
      for (const range of ranges) highlight.add(range);
      active = ranges;
    }

    const next = ranges.length ? opacity : 1;
    if (!animate || motion.matches) {
      cancelAnimationFrame(frame);
      target = next;
      finish();
      return;
    }
    if (target === next) return;
    cancelAnimationFrame(frame);
    target = next;
    const from = alpha;
    const start = performance.now();
    function tick(now: number) {
      const progress = Math.min(1, (now - start) / duration);
      if (progress === 1) return finish();
      color(from + (target - from) * progress);
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
  };
}
