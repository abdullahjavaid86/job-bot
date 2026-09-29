import pLimit from "p-limit";
import type { z } from "zod";
import type { LLM } from "../llm/types.ts";
import { log } from "../log.ts";
import { MatchResult, type Criteria, type Job, type Profile } from "../types.ts";

/** What the model returns; the apply/skip decision is made in code, not by the model. */
const Verdict = MatchResult.omit({ jobId: true, recommendation: true });

const SYSTEM = `You are a meticulous recruiting analyst assessing whether a candidate fits a job. You are given the candidate's profile and criteria (cached context) and one job posting.

Scoring (0-100): how well the candidate's real skills and experience fit the posting's requirements. 85+ = strong fit, 70-84 = good fit worth applying, 50-69 = partial, below 50 = poor. Be honest; do not inflate.

eligible / eligibilityReason: the candidate lives in criteria.candidateCountry and works remotely as an employee or contractor. Mark ineligible when the posting requires residence, citizenship, or work authorization in another specific country/region, requires on-site presence the criteria exclude, or states it cannot hire from the candidate's country. Postings open worldwide, to "anywhere", or silent on location are eligible.

rateCheck: "pass" if stated or clearly implied pay is at or above criteria.minHourlyUsd per hour (convert annual ÷ 2080, monthly ÷ 173, daily ÷ 8, non-USD at rough market rates); "fail" if below; "unknown" if pay is not stated. Put your estimate in estimatedHourlyUsd (null if unknown).

employmentTypeOk / workModeOk: whether the posting's type and mode are within the criteria lists (treat unstated as ok).

strengths / gaps: 2-5 short bullets each, concrete, referencing the posting's requirements.`;

export interface MatchOptions {
  model: string;
  minMatchScore: number;
  concurrency?: number;
}

export function buildContext(profile: Profile, criteria: Criteria): string {
  return `CANDIDATE PROFILE\n${JSON.stringify(profile, null, 2)}\n\nCRITERIA\n${JSON.stringify(criteria, null, 2)}`;
}

/**
 * The apply rule. Kept in code so that changing minMatchScore in criteria.json re-qualifies
 * already-scored jobs; the same rule is expressed in SQL in StateStore.pendingApplications.
 */
export function decideRecommendation(
  v: Pick<MatchResult, "score" | "eligible" | "rateCheck" | "employmentTypeOk" | "workModeOk">,
  minMatchScore: number,
): MatchResult["recommendation"] {
  return v.eligible &&
    v.rateCheck !== "fail" &&
    v.employmentTypeOk &&
    v.workModeOk &&
    v.score >= minMatchScore
    ? "apply"
    : "skip";
}

export async function matchJob(
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
  return {
    jobId: job.id,
    ...verdict,
    recommendation: decideRecommendation(verdict, opts.minMatchScore),
  };
}

export async function matchJobs(
  llm: LLM,
  profile: Profile,
  criteria: Criteria,
  jobs: Job[],
  opts: Omit<MatchOptions, "minMatchScore"> & { minMatchScore?: number },
  onResult?: (m: MatchResult) => void,
): Promise<MatchResult[]> {
  const cached = buildContext(profile, criteria);
  const limit = pLimit(opts.concurrency ?? llm.concurrency);
  const full: MatchOptions = {
    ...opts,
    minMatchScore: opts.minMatchScore ?? criteria.minMatchScore,
  };
  const results = await Promise.all(
    jobs.map((job) =>
      limit(async () => {
        try {
          const m = await matchJob(llm, cached, job, full);
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
