import type { Criteria, Job } from "../types.ts";

export interface SearchContext {
  criteria: Criteria;
  keywords: string[];
  /** Hard cap on jobs a single source should return. */
  limit: number;
}

export interface JobSource {
  readonly name: string;
  /** True when the source needs a real browser (Playwright). */
  readonly needsBrowser: boolean;
  search(ctx: SearchContext): Promise<Job[]>;
}
