import type { PageStatus } from "../core/page-status";

export function statusFeedback(status: Exclude<PageStatus, { kind: "cut" }>): { title: string; detail?: string } {
  switch (status.kind) {
    case "no-content":
      return { title: "Nothing to cut here", detail: status.hint === "open-post" ? "Open a post or article to cut it." : undefined };
    case "nothing-to-cut":
      return { title: "Nothing to cut here" };
    case "failed": {
      let detail = "Selection failed.";
      if (/fetch|network/i.test(status.reason)) detail = "The local bridge is unavailable.";
      else if (/timeout|timed out/i.test(status.reason)) detail = "The selection timed out.";
      else if (/invalid selection/i.test(status.reason)) detail = "The bridge returned an invalid selection.";
      else if (status.reason === "The page couldn't be read.") detail = status.reason;
      return { title: "Couldn't get cuts for this page", detail };
    }
    case "reading":
      return { title: "Reading…" };
  }
}
