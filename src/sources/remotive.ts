import type { Job } from "../types.ts";
import type { JobSource, SearchContext } from "./types.ts";
import {
  fetchJson,
  htmlToText,
  isoDate,
  normalizeEmployment,
  salaryFields,
  truncate,
} from "./common.ts";

export interface RemotiveJob {
  id: number;
  url: string;
  title: string;
  company_name: string;
  category: string;
  job_type: string;
  publication_date: string;
  candidate_required_location: string;
  salary: string;
  description: string;
  tags: string[];
}

export function mapRemotive(j: RemotiveJob): Job {
  return {
    id: `remotive:${j.id}`,
    source: "remotive",
    title: j.title,
    company: j.company_name,
    url: j.url,
    location: j.candidate_required_location || "Remote",
    workMode: "remote",
    employmentType: normalizeEmployment(j.job_type),
    ...salaryFields(j.salary ?? ""),
    applicants: null,
    postedAt: isoDate(j.publication_date),
    description: truncate(htmlToText(j.description ?? "")),
    tags: j.tags ?? [],
  };
}

export const remotive: JobSource = {
  name: "remotive",
  needsBrowser: false,
  async search(ctx: SearchContext): Promise<Job[]> {
    const out = new Map<string, Job>();
    for (const kw of ctx.keywords) {
      const data = await fetchJson<{ jobs: RemotiveJob[] }>(
        `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(kw)}&limit=${ctx.limit}`,
      );
      for (const j of data.jobs) out.set(String(j.id), mapRemotive(j));
      if (out.size >= ctx.limit) break;
    }
    return [...out.values()];
  },
};
