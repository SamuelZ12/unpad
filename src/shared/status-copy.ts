import type { PageStatus } from "../core/page-status";

export function statusFeedback(status: Exclude<PageStatus, { kind: "cut" }>): { title: string; detail?: string } {
  switch (status.kind) {
    case "no-content":
      return { title: "Nothing to cut here", detail: status.hint === "open-post" ? "Open a post or article to cut it." : undefined };
    case "nothing-to-cut":
      return { title: "Nothing to cut here" };
    case "failed":
      return { title: "Couldn't get cuts for this page" };
    case "reading":
      return { title: "Reading…" };
  }
}
