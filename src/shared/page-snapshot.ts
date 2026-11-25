import type { PageStatus } from "../core/page-status";

export interface PageSnapshot {
  url: string;
  mode?: "site" | "page";
  lensOn: boolean;
  status?: PageStatus;
}
