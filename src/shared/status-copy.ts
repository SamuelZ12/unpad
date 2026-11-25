import type { PageStatus } from "../core/page-status";

export function statusFeedback(status: PageStatus): { title: string; detail?: string } | undefined {
  switch (status.kind) {
    case "no-content":
      return { title: "Nothing to cut here", detail: status.hint === "open-post" ? "Open a post or article to cut it." : undefined };
    case "nothing-to-cut":
      return { title: "Nothing to cut here" };
    case "failed": {
      const reason = status.reason.split("\n", 1)[0];
      const detail = reason.length <= 100 ? reason : reason.slice(0, 99) + "…";
      return { title: "Couldn't get cuts for this page", detail };
    }
    case "reading":
      return { title: "Reading…" };
  }
}
