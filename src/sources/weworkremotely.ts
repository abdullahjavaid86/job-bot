import { XMLParser } from "fast-xml-parser";
import type { Job } from "../types.ts";
import type { JobSource, SearchContext } from "./types.ts";
import {
  fetchText,
  htmlToText,
  isoDate,
  keywordMatches,
  noSalary,
  normalizeEmployment,
  truncate,
} from "./common.ts";

export interface WwrItem {
  title: string;
  link: string;
  guid?: string | { "#text": string };
  region?: string;
  country?: string;
  type?: string;
  category?: string;
  skills?: string;
  description?: string;
  pubDate?: string;
}

export function parseWwrRss(xml: string): WwrItem[] {
  const parser = new XMLParser({ ignoreAttributes: false });
  const doc = parser.parse(xml) as { rss?: { channel?: { item?: WwrItem | WwrItem[] } } };
  const items = doc.rss?.channel?.item;
  if (!items) return [];
  return Array.isArray(items) ? items : [items];
}

export function mapWwr(item: WwrItem): Job {
  const [companyPart, ...rest] = String(item.title).split(":");
  const company = rest.length ? companyPart!.trim() : "";
  const title = rest.length ? rest.join(":").trim() : String(item.title).trim();
  const guid = typeof item.guid === "object" ? item.guid["#text"] : item.guid;
  const link = String(item.link);
  return {
    id: `weworkremotely:${(guid ?? link).replace(/^https?:\/\//, "")}`,
    source: "weworkremotely",
    title,
    company,
    url: link,
    location: [item.region, item.country].filter(Boolean).join(", ") || "Remote",
    workMode: "remote",
    employmentType: normalizeEmployment(item.type ?? ""),
    ...noSalary(),
    applicants: null,
    postedAt: isoDate(item.pubDate ?? null),
    description: truncate(htmlToText(String(item.description ?? ""))),
    tags: [item.category, item.skills].filter((x): x is string => Boolean(x)),
  };
}

export const weworkremotely: JobSource = {
  name: "weworkremotely",
  needsBrowser: false,
  async search(ctx: SearchContext): Promise<Job[]> {
    const xml = await fetchText("https://weworkremotely.com/remote-jobs.rss");
    return parseWwrRss(xml)
      .filter((i) =>
        keywordMatches(`${i.title} ${i.skills ?? ""} ${i.category ?? ""}`, ctx.keywords),
      )
      .slice(0, ctx.limit)
      .map(mapWwr);
  },
};
