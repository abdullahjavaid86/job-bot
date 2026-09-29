import type { Job, SalaryPeriod } from "../types.ts";
import type { JobSource, SearchContext } from "./types.ts";
import {
  fetchJson,
  htmlToText,
  isoDate,
  keywordMatches,
  normalizeEmployment,
  truncate,
} from "./common.ts";

export interface HimalayasJob {
  guid: string;
  title: string;
  companyName: string;
  applicationLink: string;
  description: string;
  excerpt: string;
  employmentType: string;
  locationRestrictions: string[];
  timezoneRestrictions: string[];
  minSalary: number | null;
  maxSalary: number | null;
  currency: string | null;
  salaryPeriod: string | null;
  pubDate: number;
  categories: string[];
  seniority: string[];
}

function period(p: string | null): SalaryPeriod | null {
  const t = (p ?? "").toLowerCase();
  if (t.startsWith("hour")) return "hour";
  if (t.startsWith("day")) return "day";
  if (t.startsWith("week")) return "week";
  if (t.startsWith("month")) return "month";
  if (t.startsWith("year") || t.startsWith("annual")) return "year";
  return null;
}

export function mapHimalayas(j: HimalayasJob): Job {
  const hasSalary = j.minSalary !== null || j.maxSalary !== null;
  const loc = j.locationRestrictions.length ? j.locationRestrictions.join(", ") : "Worldwide";
  return {
    id: `himalayas:${j.guid}`,
    source: "himalayas",
    title: j.title,
    company: j.companyName,
    url: j.applicationLink,
    location: loc,
    workMode: "remote",
    employmentType: normalizeEmployment(j.employmentType),
    salaryText: hasSalary
      ? `${j.currency ?? ""} ${j.minSalary ?? "?"}-${j.maxSalary ?? "?"} per ${j.salaryPeriod ?? "?"}`
      : "",
    salaryMin: j.minSalary,
    salaryMax: j.maxSalary,
    salaryCurrency: hasSalary ? j.currency : null,
    salaryPeriod: hasSalary ? period(j.salaryPeriod) : null,
    applicants: null,
    postedAt: isoDate(j.pubDate),
    description: truncate(htmlToText(j.description ?? j.excerpt ?? "")),
    tags: [...(j.categories ?? []), ...(j.seniority ?? [])],
  };
}

export const himalayas: JobSource = {
  name: "himalayas",
  needsBrowser: false,
  async search(ctx: SearchContext): Promise<Job[]> {
    const out: Job[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 8 && out.length < ctx.limit; page++) {
      const url: string = `https://himalayas.app/jobs/api?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const data: { jobs: HimalayasJob[]; nextCursor?: string | null } = await fetchJson(url);
      for (const j of data.jobs) {
        if (keywordMatches(`${j.title} ${j.categories?.join(" ")} ${j.excerpt}`, ctx.keywords))
          out.push(mapHimalayas(j));
      }
      cursor = data.nextCursor ?? null;
      if (!cursor || data.jobs.length === 0) break;
    }
    return out.slice(0, ctx.limit);
  },
};
