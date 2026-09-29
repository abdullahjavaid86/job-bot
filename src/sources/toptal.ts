import type { Page } from "playwright";
import type { Job } from "../types.ts";
import type { JobSource, SearchContext } from "./types.ts";
import type { BrowserSourceOptions } from "./indeed.ts";
import { newPage, sleep } from "../browser.ts";
import { keywordMatches, noSalary, normalizeEmployment, truncate } from "./common.ts";

export interface ToptalListing {
  url: string;
  title: string;
  snippet: string;
}

const CATEGORY_PAGES = [
  "https://www.toptal.com/freelance-jobs/developers/jobs",
  "https://www.toptal.com/freelance-jobs/designers/jobs",
  "https://www.toptal.com/freelance-jobs/product-managers/jobs",
  "https://www.toptal.com/freelance-jobs/project-managers/jobs",
  "https://www.toptal.com/freelance-jobs/management-consultants/jobs",
];

/** e.g. https://www.toptal.com/freelance-jobs/developers/react-native/remote-react-native-developer-job-for-startup-full-time-172 */
export const TOPTAL_JOB_RE =
  /^https:\/\/www\.toptal\.com\/freelance-jobs\/[^/]+\/[^/]+\/[^/#?]+-\d+\/?$/;
/** e.g. https://www.toptal.com/freelance-jobs/developers/react */
export const TOPTAL_SKILL_RE = /^https:\/\/www\.toptal\.com\/freelance-jobs\/[^/]+\/[^/#?]+\/?$/;

export function mapToptal(listing: ToptalListing, description: string): Job {
  const slug = listing.url.split("/").findLast(Boolean) ?? listing.url;
  return {
    id: `toptal:${slug}`,
    source: "toptal",
    title: listing.title,
    company: "Toptal client",
    url: listing.url,
    applyUrl: listing.url,
    location: "Remote (Toptal network)",
    workMode: "remote",
    employmentType:
      normalizeEmployment(listing.title) === "unknown"
        ? "freelance"
        : normalizeEmployment(listing.title),
    ...noSalary(),
    applicants: null,
    postedAt: null,
    description: truncate(description || listing.snippet),
    tags: ["toptal"],
  };
}

interface Anchor {
  url: string;
  text: string;
}

async function anchors(page: Page): Promise<Anchor[]> {
  return page.$$eval("a[href*='/freelance-jobs/']", (as) =>
    as.map((a) => ({
      url: (a as HTMLAnchorElement).href,
      text: (a as HTMLElement).innerText.trim().replace(/\s+/g, " "),
    })),
  );
}

export function pickSkillPages(links: Anchor[], keywords: string[], max = 4): string[] {
  const words = new Set(
    keywords
      .flatMap((k) => k.toLowerCase().split(/\s+/))
      .filter(
        (w) => w.length > 2 && !/^(developer|engineer|jobs?|remote|senior|junior|lead)$/.test(w),
      ),
  );
  const out: string[] = [];
  for (const l of links) {
    if (!TOPTAL_SKILL_RE.test(l.url) || /\/jobs\/?$/.test(l.url)) continue;
    const slug = l.url.split("/").findLast(Boolean)?.toLowerCase() ?? "";
    if ([...words].some((w) => slug.includes(w) || l.text.toLowerCase().includes(w))) {
      if (!out.includes(l.url)) out.push(l.url);
      if (out.length >= max) break;
    }
  }
  return out;
}

/**
 * Toptal is a vetted talent network: jobs are only claimable after passing its screening.
 * This source surfaces them so the match report shows them; the applier marks them
 * `needs_manual` because applying means joining the network, not filling a form.
 */
export function toptalSource(opts: BrowserSourceOptions): JobSource {
  return {
    name: "toptal",
    needsBrowser: true,
    async search(ctx: SearchContext): Promise<Job[]> {
      const page = await newPage(opts.dataDir, opts.headless);
      const out = new Map<string, Job>();
      const listings = new Map<string, ToptalListing>();
      try {
        const queue = [...CATEGORY_PAGES];
        const visited = new Set<string>();
        while (queue.length && listings.size < ctx.limit * 3) {
          const url = queue.shift()!;
          if (visited.has(url)) continue;
          visited.add(url);
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
          await sleep(2000);
          const links = await anchors(page);
          if (url === CATEGORY_PAGES[0]) queue.push(...pickSkillPages(links, ctx.keywords));
          for (const l of links) {
            if (TOPTAL_JOB_RE.test(l.url) && l.text.length > 3 && !listings.has(l.url))
              listings.set(l.url, { url: l.url, title: l.text, snippet: "" });
          }
        }
        for (const l of listings.values()) {
          if (out.size >= ctx.limit) break;
          if (!keywordMatches(l.title, ctx.keywords)) continue;
          let description = "";
          try {
            await page.goto(l.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
            await sleep(1200);
            description = (await page.innerText("main").catch(() => page.innerText("body")))
              .trim()
              .slice(0, 12_000);
          } catch {
            description = "";
          }
          out.set(l.url, mapToptal(l, description));
        }
      } finally {
        await page.close();
      }
      return [...out.values()];
    },
  };
}
