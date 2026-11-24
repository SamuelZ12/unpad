const markName = "filler-cut-key";
const markProperty = "--filler-cut-mark-opacity";
const duration = 160;
const rootSelectors = [
  "[data-article-body-html]",
  "[data-testid=twitterArticleRichTextView]",
  "[data-testid=tweetText]",
  ".text-rich-text--article",
  "div[dir=auto][lang]",
];

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
  return [...byColor].map(([color, paths]) => {
    const rgb = color.startsWith("rgb") ? color.match(/[\d.]+/g)?.slice(0, 3).map(Number) : undefined;
    const dark = rgb ? rgb.reduce((sum, channel) => sum + channel, 0) > 384
      : matchMedia("(prefers-color-scheme: dark)").matches;
    return `:is(${paths.join(",")})::highlight(${markName}){background-color:rgba(255,214,10,calc(${dark ? 0.26 : 0.42} * var(${markProperty})))}`;
  }).join("\n");
}

export function createMarkPainter() {
  const sheet = new CSSStyleSheet();
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  const mark = new Highlight();
  CSS.highlights.set(markName, mark);
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  let styles = "";
  let opacity = 0;
  let frame = 0;

  function updateStyles() {
    const next = highlightStyles([...mark] as Range[]);
    if (styles === next) return;
    styles = next;
    sheet.replaceSync(`:root { ${markProperty}: ${opacity} }\n${styles}`);
  }

  function color(value: number) {
    opacity = value;
    (sheet.cssRules[0] as CSSStyleRule | undefined)?.style.setProperty(markProperty, String(value));
  }

  motion.addEventListener("change", () => {
    if (!motion.matches || !mark.size) return;
    cancelAnimationFrame(frame);
    color(1);
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", updateStyles);

  return (ranges: readonly Range[]) => {
    const wasMarked = !!mark.size;
    mark.clear();
    for (const range of ranges) mark.add(range);
    updateStyles();
    if (!ranges.length) {
      cancelAnimationFrame(frame);
      color(0);
    } else if (!wasMarked) {
      if (motion.matches) color(1);
      else {
        const start = performance.now();
        function animate(now: number) {
          color(Math.max(0, Math.min(1, (now - start) / duration)));
          if (opacity < 1) frame = requestAnimationFrame(animate);
        }
        frame = requestAnimationFrame(animate);
      }
    }
  };
}
