import { collapse } from "../core/segment";
import type { Surface } from "../shared/types";

interface SurfaceDoc {
  readonly root: Element;
  readonly surface: Surface;
  readonly title: string;
  readonly blocks: readonly Element[];
}

const nonProse = "nav, header, footer, aside, form, figure, figcaption, pre, table, h1, h2, h3, h4, h5, h6, [hidden], [aria-hidden=true]";
const prose = "p, li, blockquote";
const xAppArticle = "[data-testid=twitterArticleRichTextView]";
const xPublicArticle = "[data-article-body-html]";

function xStatus(document: Document, path: string): SurfaceDoc[] {
  const match = path.match(/^\/[\w]+\/status\/(\d+)\/?$/);
  if (!match) return [];
  const status = path.replace(/\/$/, "").toLowerCase();
  const tweet = [...document.querySelectorAll(
    "article[data-testid=tweet], main article",
  )].find((article) => [...article.querySelectorAll<HTMLAnchorElement>("a[href]")].some((anchor) =>
    anchor.closest("article") === article && anchor.pathname.toLowerCase() === status && (!!anchor.querySelector("time") || anchor.matches('[aria-current="page"]'))));
  if (!tweet) return [];

  const inApp = tweet.matches("[data-testid=tweet]");
  const article = tweet.querySelector(inApp ? xAppArticle : xPublicArticle);
  if (article) {
    const title = collapse(tweet.querySelector(inApp ? "[data-testid=twitter-article-title]" : "h1")?.textContent ?? "");
    const blocks = [...article.querySelectorAll(inApp ? "[data-block=true]" : "p, li, blockquote")]
      .filter((block) => !block.closest(nonProse) && !block.querySelector(prose));
    return [{ root: article, title, blocks, surface: "x-article" }];
  }

  const post = tweet.querySelector(inApp ? "[data-testid=tweetText]" : "div[dir=auto][lang]");
  return post ? [{ root: post, title: "", blocks: [post], surface: "x-post" }] : [];
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

export function surfaces(document: Document, url: URL): SurfaceDoc[] {
  if (url.hostname === "x.com") return xStatus(document, url.pathname);
  if (url.hostname === "claude.com") return blog(document, url.pathname);
  return [];
}
