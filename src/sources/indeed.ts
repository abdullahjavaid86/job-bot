import type { Page } from "playwright";
import type { Job } from "../types.ts";
import type { JobSource, SearchContext } from "./types.ts";
import { newPage, sleep } from "../browser.ts";
import {
  noSalary,
  normalizeEmployment,
  normalizeWorkMode,
  salaryFields,
  truncate,
} from "./common.ts";
import { log } from "../log.ts";

export interface IndeedCard {
  jk: string;
  title: string;
  company: string;
  location: string;
  salary: string;
}

export interface BrowserSourceOptions {
  dataDir: string;
  headless: boolean;
}

export function mapIndeed(card: IndeedCard, description: string): Job {
  const url = `https://www.indeed.com/viewjob?jk=${card.jk}`;
  return {
    id: `indeed:${card.jk}`,
    source: "indeed",
    title: card.title,
    company: card.company,
    url,
    applyUrl: url,
    location: card.location,
    workMode: normalizeWorkMode(`${card.location} ${card.title}`, "remote"),
    employmentType: normalizeEmployment(description.slice(0, 1500)),
    ...(card.salary ? salaryFields(card.salary) : noSalary()),
    applicants: null,
    postedAt: null,
    description: truncate(description),
    tags: [],
  };
}

async function readCards(page: Page): Promise<IndeedCard[]> {
  return page.$$eval("[data-jk]", (nodes) =>
    nodes.map((n) => {
      const el = n as HTMLElement;
      const text = (sel: string) =>
        (el.querySelector(sel) as HTMLElement | null)?.innerText?.trim() ?? "";
      return {
        jk: el.getAttribute("data-jk") ?? "",
        title: text("h2 span, .jobTitle"),
        company: text("[data-testid='company-name'], .companyName"),
        location: text("[data-testid='text-location'], .companyLocation"),
        salary: text(
          "[data-testid='attribute_snippet_testid'], .salary-snippet-container, .estimated-salary",
        ),
      };
    }),
  );
}

export function indeedSource(opts: BrowserSourceOptions): JobSource {
  return {
    name: "indeed",
    needsBrowser: true,
    async search(ctx: SearchContext): Promise<Job[]> {
      const page = await newPage(opts.dataDir, opts.headless);
      const out = new Map<string, Job>();
      try {
        for (const kw of ctx.keywords) {
          if (out.size >= ctx.limit) break;
          const url = `https://www.indeed.com/jobs?q=${encodeURIComponent(kw)}&l=Remote&sc=0kf%3Aattr(DSQF7)%3B&fromage=7`;
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
          await sleep(2500);
          if (
            /verify you are human|just a moment|additional verification/i.test(await page.content())
          ) {
            log.warn("indeed: bot check shown. Solve it in the browser window; waiting up to 90s…");
            await page.waitForSelector("[data-jk]", { timeout: 90_000 }).catch(() => null);
          }
          const cards = (await readCards(page)).filter((c) => c.jk && c.title);
          for (const card of cards) {
            if (out.has(card.jk) || out.size >= ctx.limit) continue;
            let description = "";
            try {
              await page.click(`[data-jk="${card.jk}"] a`, { timeout: 5_000 });
              await page.waitForSelector("#jobDescriptionText", { timeout: 10_000 });
              description = (await page.innerText("#jobDescriptionText")).trim();
            } catch {
              description = "";
            }
            out.set(card.jk, mapIndeed(card, description));
            await sleep(800);
          }
        }
      } finally {
        await page.close();
      }
      return [...out.values()];
    },
  };
}
