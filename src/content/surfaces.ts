import { collapse } from "../core/segment";
import { MIN_ARTICLE_BLOCKS, MIN_BLOCK_WORDS } from "../shared/config";
import type { Surface } from "../shared/types";

export type ReadText = (node: Text) => string;

export const projectionSelector = "[data-filler-cut-fragment], [data-filler-cut-marker], [data-filler-cut-restored]";

interface SurfaceDoc {
  readonly root: Element;
  readonly surface: Surface;
  readonly title: string;
  readonly blocks: readonly Element[];
  readonly generic?: boolean;
  readonly identity?: string;
}

const nonProse = "nav, header, footer, aside, form, figure, figcaption, pre, table, h1, h2, h3, h4, h5, h6, [hidden], [aria-hidden=true]";
const editable = '[contenteditable=""], [contenteditable="true" i], [contenteditable="plaintext-only" i]';
const privateText = `[hidden], [aria-hidden=true], ${editable}`;
const genericNonProse = `${nonProse}, ${editable}`;
const prose = "p, li, blockquote";
// Hand-written pages put the text straight into a layout table cell or <font> and break paragraphs with <br>.
const bareNonProse = `nav, header, footer, aside, form, pre, script, style, noscript, textarea, template, ${privateText}`;
export const xPostBody = "[data-testid=tweetText]";
const xShowMore = "[data-testid=tweet-text-show-more-link]";
const xAppArticle = "[data-testid=twitterArticleRichTextView]";
const xPublicArticle = "[data-article-body-html]";

function xSurfaces(document: Document, path: string): SurfaceDoc[] {
  const docs: SurfaceDoc[] = [];
  for (const article of document.querySelectorAll(`main ${xAppArticle}`)) {
    const title = collapse(article.closest("article")?.querySelector("[data-testid=twitter-article-title]")?.textContent ?? "");
    const blocks = [...article.querySelectorAll("[data-block=true]")]
      .filter((block) => !block.closest(nonProse) && !block.querySelector(prose));
    docs.push({ root: article, title, blocks, surface: "x-article" });
  }
  for (const post of document.querySelectorAll(`main ${xPostBody}`)) {
    if (post.closest(privateText)) continue;
    const more = post.nextElementSibling?.matches(xShowMore) ? post.nextElementSibling : post.querySelector(xShowMore);
    if (more && !more.closest(privateText)) continue;
    const tweet = post.closest("article[data-testid=tweet]");
    const permalink = tweet?.querySelector<HTMLAnchorElement>('a[href*="/status/"]:has(time), a[aria-current=page][href*="/status/"]');
    const position = tweet ? Array.from(tweet.querySelectorAll(xPostBody)).indexOf(post) : 0;
    const identity = permalink ? `${permalink.pathname}:${position}` : undefined;
    docs.push({ root: post, title: "", blocks: [post], surface: "x-post", identity });
  }

  // Public X uses different markup. Its permalink identifies the post.
  if (!/^\/\w+\/status\/\d+\/?$/.test(path)) return docs;
  const status = path.replace(/\/$/, "").toLowerCase();
  const tweet = [...document.querySelectorAll("main article:not([data-testid=tweet])")].find((article) =>
    [...article.querySelectorAll<HTMLAnchorElement>("a[href]")].some((anchor) =>
      anchor.closest("article") === article && anchor.pathname.toLowerCase() === status &&
      (!!anchor.querySelector("time") || anchor.matches('[aria-current="page"]'))));
  if (!tweet) return docs;
  const body = tweet.querySelector(xPublicArticle);
  if (body) {
    const title = collapse(tweet.querySelector("h1")?.textContent ?? "");
    const blocks = [...body.querySelectorAll(prose)].filter((block) => !block.closest(nonProse) && !block.querySelector(prose));
    docs.push({ root: body, title, blocks, surface: "x-article" });
    return docs;
  }
  const post = tweet.querySelector("div[dir=auto][lang]");
  if (post && !docs.some(({ root }) => root === post)) docs.push({ root: post, title: "", blocks: [post], surface: "x-post" });
  return docs;
}

function blog(document: Document, path: string): SurfaceDoc[] {
  const body = document.querySelector("article .text-rich-text--article, article [itemprop=articleBody]") ??
    (/^\/(?:blog|resources\/articles)\/[^/]+\/?$/.test(path)
      ? [...document.querySelectorAll("main article")].find((article) => article.querySelector("h1"))
      : undefined);
  if (!body) return [];
  const title = collapse(body.closest("article")?.querySelector("h1")?.textContent ?? document.title);
  const blocks = [...body.querySelectorAll(prose)].filter((block) =>
    !block.closest(nonProse) && !block.querySelector(prose));
  return [{ root: body, title, blocks, surface: "blog" }];
}

export function textWalker(root: Element, generic: boolean) {
  return root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, (node) => {
    if (node instanceof Text) return NodeFilter.FILTER_ACCEPT;
    if (!(node instanceof Element)) return NodeFilter.FILTER_SKIP;
    if (node.matches(projectionSelector) || (generic && node.matches(privateText))) return NodeFilter.FILTER_REJECT;
    return generic && node.localName === "br" ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
  });
}

function genericText(root: Element, read: ReadText) {
  const walker = textWalker(root, true);
  let text = "";
  for (let node = walker.nextNode(); node; node = walker.nextNode()) text += node instanceof Text ? read(node) : "\n";
  return collapse(text);
}

function bareText(document: Document, read: ReadText) {
  let best: Element | undefined;
  let most = 0;
  for (const element of document.querySelectorAll("body *")) {
    if (element.closest(`${bareNonProse}, ${projectionSelector}`)) continue;
    let length = 0;
    for (const node of element.childNodes) if (node instanceof Text) length += collapse(read(node)).length;
    if (length > most) [best, most] = [element, length];
  }
  return best;
}

function genericArticle(document: Document, checkArticle: boolean, read: ReadText): SurfaceDoc[] {
  if (document.designMode === "on") return [];
  let root: Element | null = document.body;
  let longest = -1;
  for (const candidate of document.querySelectorAll("article, main, [role=main]")) {
    const length = [...candidate.querySelectorAll("p")].reduce((total, paragraph) =>
      total + (paragraph.closest(genericNonProse) ? 0 : genericText(paragraph, read).length), 0);
    if (length <= longest) continue;
    longest = length;
    root = candidate;
  }
  if (!root) return [];
  const heading = root === document.body ? undefined : root.querySelector("h1");
  const title = heading && !heading.closest(privateText) ? genericText(heading, read) : collapse(document.title);
  const blocks = [...root.querySelectorAll(prose)].filter((block) =>
    !block.closest(genericNonProse) &&
    ![...block.querySelectorAll(prose)].some((child) => !child.closest(privateText)));
  if (!blocks.length) {
    const block = bareText(document, read);
    if (!block || (checkArticle && genericText(block, read).split(" ").length < MIN_ARTICLE_BLOCKS * MIN_BLOCK_WORDS)) return [];
    return [{ root: block, title: collapse(document.title), blocks: [block], surface: "blog", generic: true }];
  }
  if (checkArticle && blocks.filter((block) =>
    !block.closest("ul, ol, li, dl, menu, [role=list], [role=listitem]") &&
    genericText(block, read).split(" ").length >= MIN_BLOCK_WORDS).length < MIN_ARTICLE_BLOCKS) return [];
  return [{ root, title, blocks, surface: "blog", generic: true }];
}

export function surfaces(document: Document, url: URL, checkArticle: boolean, read: ReadText) {
  if (url.hostname === "x.com") return xSurfaces(document, url.pathname);
  return url.hostname === "claude.com" ? blog(document, url.pathname) : genericArticle(document, checkArticle, read);
}

export function usesGenericSurface(url: URL) {
  return url.hostname !== "x.com" && url.hostname !== "claude.com";
}
