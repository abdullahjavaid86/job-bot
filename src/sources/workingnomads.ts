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

export interface NomadsJob {
  url: string;
  title: string;
  description: string;
  company_name: string;
  category_name: string;
  tags: string;
  location: string;
  pub_date: string;
}

export function mapNomads(j: NomadsJob): Job {
  const id = /\/job\/[^/]+\/(\d+)/.exec(j.url)?.[1] ?? j.url;
  return {
    id: `workingnomads:${id}`,
    source: "workingnomads",
    title: j.title.replace(/^[^-]+-\s*/, "").trim() || j.title,
    company: j.company_name,
    url: j.url,
    location: j.location || "Remote",
    workMode: "remote",
    employmentType: normalizeEmployment(j.description.slice(0, 600)),
    ...noSalary(),
    applicants: null,
    postedAt: isoDate(j.pub_date),
    description: truncate(htmlToText(j.description ?? "")),
    tags: [j.category_name, ...j.tags.split(",").map((t) => t.trim())].filter(Boolean),
  };
}

export const workingnomads: JobSource = {
  name: "workingnomads",
  needsBrowser: false,
  async search(ctx: SearchContext): Promise<Job[]> {
    const data = await fetchJson<NomadsJob[]>("https://www.workingnomads.com/api/exposed_jobs/");
    return data
      .filter((j) => keywordMatches(`${j.title} ${j.tags} ${j.category_name}`, ctx.keywords))
      .slice(0, ctx.limit)
      .map(mapNomads);
  },
};
