import type { Job } from "../types.ts";
import type { JobSource, SearchContext } from "./types.ts";
import { fetchJson, htmlToText, isoDate, normalizeEmployment, truncate } from "./common.ts";

export interface JobicyJob {
  id: number;
  url: string;
  jobTitle: string;
  companyName: string;
  jobGeo: string;
  jobType: string[] | string;
  jobLevel: string;
  jobDescription: string;
  jobExcerpt: string;
  pubDate: string;
  annualSalaryMin?: number;
  annualSalaryMax?: number;
  salaryCurrency?: string;
  jobIndustry?: string[] | string;
}

export function mapJobicy(j: JobicyJob): Job {
  const min = j.annualSalaryMin ?? null;
  const max = j.annualSalaryMax ?? null;
  const has = min !== null || max !== null;
  return {
    id: `jobicy:${j.id}`,
    source: "jobicy",
    title: j.jobTitle,
    company: j.companyName,
    url: j.url,
    location: j.jobGeo || "Anywhere",
    workMode: "remote",
    employmentType: normalizeEmployment(j.jobType),
    salaryText: has ? `${j.salaryCurrency ?? "USD"} ${min ?? "?"}-${max ?? "?"} per year` : "",
    salaryMin: min,
    salaryMax: max,
    salaryCurrency: has ? (j.salaryCurrency ?? "USD") : null,
    salaryPeriod: has ? "year" : null,
    applicants: null,
    postedAt: isoDate(j.pubDate),
    description: truncate(htmlToText(j.jobDescription ?? j.jobExcerpt ?? "")),
    tags: [
      j.jobLevel,
      ...(Array.isArray(j.jobIndustry) ? j.jobIndustry : j.jobIndustry ? [j.jobIndustry] : []),
    ].filter(Boolean),
  };
}

export const jobicy: JobSource = {
  name: "jobicy",
  needsBrowser: false,
  async search(ctx: SearchContext): Promise<Job[]> {
    const out = new Map<number, Job>();
    for (const kw of ctx.keywords) {
      const data = await fetchJson<{ jobs: JobicyJob[] }>(
        `https://jobicy.com/api/v2/remote-jobs?count=50&tag=${encodeURIComponent(kw)}`,
      );
      for (const j of data.jobs ?? []) out.set(j.id, mapJobicy(j));
      if (out.size >= ctx.limit) break;
    }
    return [...out.values()].slice(0, ctx.limit);
  },
};
