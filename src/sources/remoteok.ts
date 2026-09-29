import type { Job } from "../types.ts";
import type { JobSource, SearchContext } from "./types.ts";
import {
  fetchJson,
  htmlToText,
  isoDate,
  keywordMatches,
  normalizeEmployment,
  truncate,
} from "./common.ts";

export interface RemoteOkJob {
  id: string;
  slug: string;
  url: string;
  apply_url?: string;
  position: string;
  company: string;
  location: string;
  tags: string[];
  description: string;
  date: string;
  salary_min?: number;
  salary_max?: number;
}

export function mapRemoteOk(j: RemoteOkJob): Job {
  const min = j.salary_min && j.salary_min > 0 ? j.salary_min : null;
  const max = j.salary_max && j.salary_max > 0 ? j.salary_max : null;
  const salaryText = min || max ? `$${min ?? "?"} - $${max ?? "?"} / year` : "";
  return {
    id: `remoteok:${j.id}`,
    source: "remoteok",
    title: j.position,
    company: j.company.trim(),
    url: j.url,
    ...(j.apply_url ? { applyUrl: j.apply_url } : {}),
    location: j.location || "Remote",
    workMode: "remote",
    employmentType: normalizeEmployment(`${j.position} ${j.tags.join(" ")}`),
    salaryText,
    salaryMin: min,
    salaryMax: max,
    salaryCurrency: min || max ? "USD" : null,
    salaryPeriod: min || max ? "year" : null,
    applicants: null,
    postedAt: isoDate(j.date),
    description: truncate(htmlToText(j.description ?? "")),
    tags: j.tags ?? [],
  };
}

export const remoteok: JobSource = {
  name: "remoteok",
  needsBrowser: false,
  async search(ctx: SearchContext): Promise<Job[]> {
    const data = await fetchJson<Array<Record<string, unknown>>>("https://remoteok.com/api");
    const jobs = data.filter(
      (d): d is Record<string, unknown> & RemoteOkJob =>
        typeof d.id === "string" && typeof d.position === "string",
    );
    return jobs
      .filter((j) =>
        keywordMatches(`${j.position} ${j.tags.join(" ")} ${j.description}`, ctx.keywords),
      )
      .slice(0, ctx.limit)
      .map(mapRemoteOk);
  },
};
