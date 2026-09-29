import type { Job } from "../types.ts";
import type { JobSource, SearchContext } from "./types.ts";
import {
  fetchJson,
  htmlToText,
  isoDate,
  keywordMatches,
  noSalary,
  normalizeEmployment,
  truncate,
} from "./common.ts";

export interface ArbeitnowJob {
  slug: string;
  company_name: string;
  title: string;
  description: string;
  remote: boolean;
  url: string;
  tags: string[];
  job_types: string[];
  location: string;
  created_at: number;
}

export function mapArbeitnow(j: ArbeitnowJob): Job {
  return {
    id: `arbeitnow:${j.slug}`,
    source: "arbeitnow",
    title: j.title,
    company: j.company_name,
    url: j.url,
    location: j.location || (j.remote ? "Remote" : ""),
    workMode: j.remote ? "remote" : "unknown",
    employmentType: normalizeEmployment(j.job_types),
    ...noSalary(),
    applicants: null,
    postedAt: isoDate(j.created_at),
    description: truncate(htmlToText(j.description ?? "")),
    tags: j.tags ?? [],
  };
}

export const arbeitnow: JobSource = {
  name: "arbeitnow",
  needsBrowser: false,
  async search(ctx: SearchContext): Promise<Job[]> {
    const out: Job[] = [];
    for (let page = 1; page <= 5 && out.length < ctx.limit; page++) {
      const data = await fetchJson<{ data: ArbeitnowJob[]; links: { next: string | null } }>(
        `https://www.arbeitnow.com/api/job-board-api?remote=true&page=${page}`,
      );
      for (const j of data.data) {
        if (keywordMatches(`${j.title} ${j.tags.join(" ")}`, ctx.keywords))
          out.push(mapArbeitnow(j));
      }
      if (!data.links.next) break;
    }
    return out.slice(0, ctx.limit);
  },
};
