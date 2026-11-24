import { fadedIds, markedIds, type PageState } from "../core/state";
import type { AnchoredDoc } from "./anchor";

const name = "filler-cut";
const markName = "filler-cut-key";
const alphaProperty = "--filler-cut-alpha";
const markProperty = "--filler-cut-mark-opacity";
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

function highlightStyles(ranges: readonly Range[], marked: boolean) {
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
  return [...byColor].map(([color, paths]) => {
    if (!marked) {
      return `:is(${paths.join(",")})::highlight(${name}){color:color-mix(in srgb,${color} calc(var(${alphaProperty}) * 100%),transparent)}`;
    }
    const rgb = color.startsWith("rgb") ? color.match(/[\d.]+/g)?.slice(0, 3).map(Number) : undefined;
    const dark = rgb ? rgb.reduce((sum, channel) => sum + channel, 0) > 384
      : matchMedia("(prefers-color-scheme: dark)").matches;
    return `:is(${paths.join(",")})::highlight(${markName}){background-color:rgba(255,214,10,calc(${dark ? 0.26 : 0.42} * var(${markProperty})))}`;
  }).join("\n");
}

export function createPainter() {
  const animation = new CSSStyleSheet();
  animation.replaceSync(`:root { ${alphaProperty}: 1; ${markProperty}: 0 }`);
  const colors = new CSSStyleSheet();
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, animation, colors];
  const rule = animation.cssRules[0] as CSSStyleRule;
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  // The highlight paints ranges in place and leaves the site's DOM and layout intact.
  const fade = new Highlight();
  const mark = new Highlight();
  CSS.highlights.set(name, fade);
  CSS.highlights.set(markName, mark);
  let frame = 0;
  let amount = 0;
  let target = 0;
  let styles = "";

  function updateStyles() {
    const next = highlightStyles([...fade] as Range[], false) + "\n" + highlightStyles([...mark] as Range[], true);
    if (styles === next) return;
    styles = next;
    colors.replaceSync(styles);
  }

  function color(value: number) {
    amount = value;
    rule.style.setProperty(alphaProperty, String(1 - (1 - opacity) * amount));
    rule.style.setProperty(markProperty, String(amount));
  }

  function finish() {
    color(target);
    if (target !== 0) return;
    fade.clear();
    mark.clear();
    updateStyles();
  }

  motion.addEventListener("change", () => {
    if (!motion.matches) return;
    cancelAnimationFrame(frame);
    finish();
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", updateStyles);

  function updateRanges(highlight: Highlight, ranges: readonly Range[]) {
    const current = new Set<AbstractRange>(ranges);
    for (const range of highlight) if (!current.has(range)) highlight.delete(range);
    for (const range of current) if (!highlight.has(range)) highlight.add(range);
  }

  return function paint(docs: readonly AnchoredDoc[], state: PageState, animate = true) {
    const fades = fadedRanges(docs, state);
    const marks = docs.flatMap(({ doc, ranges }) => markedIds(state, doc.key).map((id) => ranges[id - 1]));
    const next = fades.length || marks.length ? 1 : 0;
    // A click only needs to remove its range. Leave the other ranges and styles in place.
    if (!animate && next && fades.length + marks.length < fade.size + mark.size
      && fades.every((range) => fade.has(range)) && marks.every((range) => mark.has(range))) {
      updateRanges(fade, fades);
      updateRanges(mark, marks);
      return;
    }
    if (next) {
      updateRanges(fade, fades);
      updateRanges(mark, marks);
      updateStyles();
    }

    if (!animate || motion.matches) {
      cancelAnimationFrame(frame);
      target = next;
      finish();
      return;
    }
    if (target === next) return;
    cancelAnimationFrame(frame);
    target = next;
    const from = amount;
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
