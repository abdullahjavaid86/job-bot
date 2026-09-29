import type { Criteria, Job } from "../types.ts";
import { bestHourlyUsd } from "./rate.ts";

export interface PrefilterResult {
  keep: Job[];
  rejected: Array<{ job: Job; reason: string }>;
}

const REGION_LOCKS: Array<{ re: RegExp; region: string }> = [
  {
    re: /\b(us|u\.s\.|usa|united states)[- ]?(only|based|residents?|citizens?)\b/i,
    region: "United States",
  },
  {
    re: /\bmust (be )?(located|reside|live|be based) in (the )?(us|usa|united states|u\.s\.)\b/i,
    region: "United States",
  },
  { re: /\bauthori[sz]ed to work in the (us|united states|u\.s\.)\b/i, region: "United States" },
  { re: /\b(uk|united kingdom)[- ]?(only|based|residents?)\b/i, region: "United Kingdom" },
  { re: /\b(eu|europe|european union)[- ]?(only|based|residents?)\b/i, region: "Europe" },
  {
    re: /\bmust (be )?(located|reside|live|be based) in (the )?(uk|eu|europe|canada|australia|germany|netherlands|france|spain|poland|india)\b/i,
    region: "a specific region",
  },
  { re: /\b(canada|canadian)[- ]?(only|residents?|based)\b/i, region: "Canada" },
  { re: /\b(australia|australian)[- ]?(only|residents?|based)\b/i, region: "Australia" },
  { re: /\bindia[- ]?(only|based)\b/i, region: "India" },
  { re: /\b(latam|latin america)[- ]?only\b/i, region: "LATAM" },
  { re: /\bno (visa )?sponsorship\b.*\b(us|united states)\b/i, region: "United States" },
];

const OPEN_WORLDWIDE =
  /\b(worldwide|anywhere|global|any location|all countries|remote[- ]first|fully remote|work from anywhere|international)\b/i;

export function regionLock(job: Job, candidateCountry: string): string | null {
  const text = `${job.location}\n${job.description}`;
  const country = candidateCountry.toLowerCase();
  if (new RegExp(`\\b${escape(country)}\\b`, "i").test(text)) return null;
  const locText = job.location;
  if (OPEN_WORLDWIDE.test(locText)) return null;
  for (const { re, region } of REGION_LOCKS) {
    if (re.test(text) && !new RegExp(`\\b${escape(country)}\\b`, "i").test(text)) return region;
  }
  return null;
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function prefilter(jobs: Job[], criteria: Criteria): PrefilterResult {
  const keep: Job[] = [];
  const rejected: PrefilterResult["rejected"] = [];
  const seen = new Set<string>();
  const exclude = criteria.excludeKeywords.map((k) => k.toLowerCase()).filter(Boolean);

  for (const job of jobs) {
    const dedupeKey = `${job.company.toLowerCase().trim()}|${job.title.toLowerCase().trim()}`;
    if (seen.has(dedupeKey)) {
      rejected.push({ job, reason: "duplicate title+company" });
      continue;
    }
    seen.add(dedupeKey);

    if (job.workMode !== "unknown" && !criteria.workModes.includes(job.workMode)) {
      rejected.push({ job, reason: `work mode ${job.workMode}` });
      continue;
    }
    if (
      job.employmentType !== "unknown" &&
      !criteria.employmentTypes.includes(job.employmentType)
    ) {
      rejected.push({ job, reason: `employment type ${job.employmentType}` });
      continue;
    }
    if (job.applicants !== null && job.applicants >= criteria.maxApplicants) {
      rejected.push({ job, reason: `${job.applicants} applicants` });
      continue;
    }
    if (job.applicants === null && !criteria.applyWhenApplicantsUnknown) {
      rejected.push({ job, reason: "applicant count unknown" });
      continue;
    }
    const hourly =
      job.salaryMin !== null || job.salaryMax !== null
        ? bestHourlyUsd({
            min: job.salaryMin,
            max: job.salaryMax,
            currency: job.salaryCurrency,
            period: job.salaryPeriod,
          })
        : null;
    if (hourly !== null && hourly < criteria.minHourlyUsd) {
      rejected.push({ job, reason: `pay ≈ $${hourly.toFixed(0)}/h < $${criteria.minHourlyUsd}/h` });
      continue;
    }
    const lock = regionLock(job, criteria.candidateCountry);
    if (lock) {
      rejected.push({ job, reason: `restricted to ${lock}` });
      continue;
    }
    const hay = `${job.title} ${job.description}`.toLowerCase();
    const hit = exclude.find((k) => hay.includes(k));
    if (hit) {
      rejected.push({ job, reason: `excluded keyword "${hit}"` });
      continue;
    }
    keep.push(job);
  }
  return { keep, rejected };
}
