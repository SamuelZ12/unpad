import { issue } from "./connection";
import type { PageStatus } from "../core/page-status";

export function statusFeedback(status: Exclude<PageStatus, { kind: "cut" }>): { title: string; detail?: string } {
  switch (status.kind) {
    case "nothing-to-cut":
      return { title: "Nothing to cut here" };
    case "failed":
      return Object.values(issue).some((message) => message === status.reason) && status.reason !== issue.failed
        ? { title: status.reason, ...(status.reason === issue.usage && { detail: "Open the extension to manage usage." }) }
        : { title: "Couldn't get cuts for this page" };
    case "reading":
      return { title: "Reading…" };
  }
}
