import type { PageStatus } from "../core/page-status";

export interface PageSnapshot {
  mode?: "site" | "page";
  lensOn: boolean;
  status?: PageStatus;
}

export interface PressTarget {
  tabId: number;
  documentId: string;
  url: string;
}

export function documentRoute(url: string) {
  // Chrome exposes text fragment directives in Tab.url but hides them from the page.
  return url.replace(/(#.*?):~:.*$/, "$1").replace(/#$/, "");
}
