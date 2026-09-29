import type { EmploymentType, Job } from "../types.ts";
import type { JobSource, SearchContext } from "./types.ts";
import {
  decodeEntities,
  fetchText,
  htmlToText,
  isoDate,
  noSalary,
  normalizeEmployment,
  normalizeWorkMode,
  truncate,
} from "./common.ts";

export interface LinkedInCard {
  id: string;
  title: string;
  company: string;
  location: string;
  url: string;
  postedAt: string | null;
}

export interface LinkedInDetail {
  applicants: number | null;
  description: string;
  employmentType: EmploymentType;
  criteria: string[];
}

const clean = (s: string) => decodeEntities(s).replace(/\s+/g, " ").trim();

export function parseLinkedInCards(html: string): LinkedInCard[] {
  const cards: LinkedInCard[] = [];
  const chunks = html.split(/(?=data-entity-urn="urn:li:jobPosting:\d+")/).slice(1);
  for (const chunk of chunks) {
    const id = /^data-entity-urn="urn:li:jobPosting:(\d+)"/.exec(chunk)?.[1];
    const href = /href="([^"]+)"/.exec(chunk)?.[1];
    const title = /base-search-card__title">([\s\S]*?)<\/h3>/.exec(chunk)?.[1];
    const subtitle = /base-search-card__subtitle">([\s\S]*?)<\/h4>/.exec(chunk)?.[1] ?? "";
    const location = /job-search-card__location">([\s\S]*?)<\/span>/.exec(chunk)?.[1] ?? "";
    const time = /datetime="([^"]+)"/.exec(chunk)?.[1] ?? null;
    if (!id || !href || !title) continue;
    cards.push({
      id,
      title: clean(title.replace(/<[^>]+>/g, "")),
      company: clean(subtitle.replace(/<[^>]+>/g, "")),
      location: clean(location),
      url: decodeEntities(href).split("?")[0]!,
      postedAt: isoDate(time),
    });
  }
  return cards;
}

/** "Over 200 applicants" -> 200; "Be among the first 25 applicants" -> 25; "37 applicants" -> 37. */
export function parseApplicants(caption: string): number | null {
  const m = /(\d[\d,]*)\s*applicants?/i.exec(caption);
  if (!m) return null;
  const n = Number.parseInt(m[1]!.replace(/,/g, ""), 10);
  if (/among the first|be one of the first/i.test(caption)) return Math.max(0, n - 1);
  return n;
}

export function parseLinkedInDetail(html: string): LinkedInDetail {
  const caption =
    /num-applicants__caption[^>]*>([\s\S]*?)<\/(span|figcaption)/.exec(html)?.[1] ?? "";
  const desc =
    /class="description__text[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/section>|class="show-more-less-html__markup[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(
      html,
    );
  const criteria = [
    ...html.matchAll(/description__job-criteria-text[^>]*>([\s\S]*?)<\/span>/g),
  ].map((m) => clean(m[1]!));
  return {
    applicants: parseApplicants(clean(caption)),
    description: truncate(htmlToText(desc?.[1] ?? desc?.[2] ?? "")),
    employmentType: normalizeEmployment(criteria.join(" ")),
    criteria,
  };
}

const GUEST = "https://www.linkedin.com/jobs-guest/jobs/api";

async function fetchLinkedInDetail(id: string): Promise<LinkedInDetail> {
  return parseLinkedInDetail(await fetchText(`${GUEST}/jobPosting/${id}`));
}

export function toJob(
  card: LinkedInCard,
  detail: LinkedInDetail,
  workModeFilter: "remote" | "hybrid",
): Job {
  return {
    id: `linkedin:${card.id}`,
    source: "linkedin",
    title: card.title,
    company: card.company,
    url: card.url,
    applyUrl: card.url,
    location: card.location,
    workMode: normalizeWorkMode(`${card.location} ${card.title}`, workModeFilter),
    employmentType: detail.employmentType,
    ...noSalary(),
    applicants: detail.applicants,
    postedAt: card.postedAt,
    description: detail.description,
    tags: detail.criteria,
  };
}

export const linkedin: JobSource = {
  name: "linkedin",
  needsBrowser: false,
  async search(ctx: SearchContext): Promise<Job[]> {
    const out = new Map<string, Job>();
    const modes: Array<{ code: string; mode: "remote" | "hybrid" }> = [];
    if (ctx.criteria.workModes.includes("remote")) modes.push({ code: "2", mode: "remote" });
    if (ctx.criteria.workModes.includes("hybrid")) modes.push({ code: "3", mode: "hybrid" });
    for (const kw of ctx.keywords) {
      for (const { code, mode } of modes) {
        for (let start = 0; start < 40 && out.size < ctx.limit; start += 10) {
          const url = `${GUEST}/seeMoreJobPostings/search?keywords=${encodeURIComponent(kw)}&location=Worldwide&f_WT=${code}&f_TPR=r604800&start=${start}`;
          let cards: LinkedInCard[];
          try {
            cards = parseLinkedInCards(await fetchText(url));
          } catch {
            break;
          }
          if (cards.length === 0) break;
          for (const card of cards) {
            if (out.has(card.id) || out.size >= ctx.limit) continue;
            try {
              const detail = await fetchLinkedInDetail(card.id);
              out.set(card.id, toJob(card, detail, mode));
            } catch {
              // detail page throttled; keep the card with unknown applicants so it can still be matched
              out.set(
                card.id,
                toJob(
                  card,
                  {
                    applicants: null,
                    description: "",
                    employmentType: "unknown",
                    criteria: [],
                  },
                  mode,
                ),
              );
            }
            await new Promise((r) => setTimeout(r, 400));
          }
        }
      }
    }
    return [...out.values()];
  },
};
