import pLimit from "p-limit";
import type { z } from "zod";
import type { LLM } from "../llm/types.ts";
import { log } from "../log.ts";
import { MatchResult, type Criteria, type Job, type Profile } from "../types.ts";

const Verdict = MatchResult.omit({ jobId: true });

const SYSTEM = `You are a meticulous recruiting analyst deciding whether a candidate should apply to a job. You are given the candidate's profile and criteria (cached context) and one job posting.

Scoring (0-100): how well the candidate's real skills and experience fit the posting's requirements. 85+ = strong fit, 70-84 = good fit worth applying, 50-69 = partial, below 50 = poor. Be honest; do not inflate.

eligible / eligibilityReason: the candidate lives in criteria.candidateCountry and works remotely as an employee or contractor. Mark ineligible when the posting requires residence, citizenship, or work authorization in another specific country/region, requires on-site presence the criteria exclude, or states it cannot hire from the candidate's country. Postings open worldwide, to "anywhere", or silent on location are eligible.

rateCheck: "pass" if stated or clearly implied pay is at or above criteria.minHourlyUsd per hour (convert annual ÷ 2080, monthly ÷ 173, daily ÷ 8, non-USD at rough market rates); "fail" if below; "unknown" if pay is not stated. Put your estimate in estimatedHourlyUsd (null if unknown).

employmentTypeOk / workModeOk: whether the posting's type and mode are within the criteria lists (treat unstated as ok).

recommendation: "apply" only when eligible, rateCheck is not "fail", employmentTypeOk, workModeOk, and score >= criteria.minMatchScore. Otherwise "skip".

strengths / gaps: 2-5 short bullets each, concrete, referencing the posting's requirements.`;

export interface MatchOptions {
  model: string;
  concurrency?: number;
}

export function buildContext(profile: Profile, criteria: Criteria): string {
  return `CANDIDATE PROFILE\n${JSON.stringify(profile, null, 2)}\n\nCRITERIA\n${JSON.stringify(criteria, null, 2)}`;
}

async function matchJob(
  llm: LLM,
  cached: string,
  job: Job,
  opts: MatchOptions,
): Promise<MatchResult> {
  const { description, ...meta } = job;
  const verdict = await llm.structured({
    model: opts.model,
    system: SYSTEM,
    cachedContext: cached,
    content: `JOB POSTING\n${JSON.stringify(meta, null, 2)}\n\nDESCRIPTION\n${description.slice(0, llm.maxInputChars)}`,
    schema: Verdict,
    effort: "medium",
    maxTokens: 4_000,
  });
  return { jobId: job.id, ...verdict };
}

export async function matchJobs(
  llm: LLM,
  profile: Profile,
  criteria: Criteria,
  jobs: Job[],
  opts: MatchOptions,
  onResult?: (m: MatchResult) => void,
): Promise<MatchResult[]> {
  const cached = buildContext(profile, criteria);
  const limit = pLimit(opts.concurrency ?? llm.concurrency);
  const results = await Promise.all(
    jobs.map((job) =>
      limit(async () => {
        try {
          const m = await matchJob(llm, cached, job, opts);
          onResult?.(m);
          return m;
        } catch (err) {
          log.warn(`match failed for ${job.id}: ${(err as Error).message}`);
          return null;
        }
      }),
    ),
  );
  return results.filter((m): m is MatchResult => m !== null);
}

export type Verdict = z.infer<typeof Verdict>;
