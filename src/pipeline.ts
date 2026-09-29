import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { closeBrowser } from "./browser.ts";
import type { Config } from "./config.ts";
import { prefilter } from "./filter/prefilter.ts";
import { createLLM } from "./llm/index.ts";
import type { LLM } from "./llm/types.ts";
import { log } from "./log.ts";
import { applyToJob } from "./apply/applier.ts";
import { matchJobs } from "./match/matcher.ts";
import {
  extractProfile,
  findCv,
  inputsHash,
  readInstructions,
} from "./profile/extract.ts";
import { selectSources } from "./sources/index.ts";
import { StateStore } from "./store/state.ts";
import { Criteria, Profile, type Job } from "./types.ts";
import type { JobSource, SearchContext } from "./sources/types.ts";

export interface Runtime {
  config: Config;
  store: StateStore;
  llm: LLM;
}

export function createRuntime(config: Config): Runtime {
  return {
    config,
    store: new StateStore(config.dataDir),
    llm: createLLM(config),
  };
}

function profilePaths(dataDir: string) {
  return {
    profile: path.join(dataDir, "profile.json"),
    criteria: path.join(dataDir, "criteria.json"),
  };
}

function loadProfile(
  dataDir: string,
): { profile: Profile; criteria: Criteria } | null {
  const p = profilePaths(dataDir);
  if (!fs.existsSync(p.profile) || !fs.existsSync(p.criteria)) return null;
  return {
    profile: Profile.parse(JSON.parse(fs.readFileSync(p.profile, "utf8"))),
    criteria: Criteria.parse(JSON.parse(fs.readFileSync(p.criteria, "utf8"))),
  };
}

export async function ensureProfile(
  rt: Runtime,
  force = false,
): Promise<{ profile: Profile; criteria: Criteria; cvPath: string }> {
  const cvPath = findCv(process.cwd());
  if (!cvPath)
    throw new Error("No CV found. Put your CV at ./cv.pdf or ./resume.pdf");
  const cvBytes = fs.readFileSync(cvPath);
  const instructions = readInstructions(rt.config.instructionsPath);
  const hash = inputsHash(cvBytes, instructions);
  const cached = loadProfile(rt.config.dataDir);
  if (!force && cached && rt.store.state.profileHash === hash) {
    log.info(
      `profile: using cached profile for ${cached.profile.fullName} (data/profile.json)`,
    );
    return { ...cached, cvPath };
  }
  log.info(
    `profile: analysing ${path.basename(cvPath)}${instructions ? " + instructions.txt" : ""} with ${rt.config.provider}/${rt.config.model}…`,
  );
  const { profile, criteria } = await extractProfile(rt.llm, {
    cvBytes,
    cvFilename: cvPath,
    instructions,
    model: rt.config.model,
  });
  const p = profilePaths(rt.config.dataDir);
  fs.writeFileSync(p.profile, JSON.stringify(profile, null, 2));
  fs.writeFileSync(p.criteria, JSON.stringify(criteria, null, 2));
  rt.store.state.profileHash = hash;
  rt.store.save();
  log.info(
    `profile: ${profile.fullName} — ${profile.headline}; keywords: ${profile.searchKeywords.join(", ")}`,
  );
  log.info(
    `criteria: ${JSON.stringify({ ...criteria, extraInstructions: undefined })}`,
  );
  return { profile, criteria, cvPath };
}

export interface SearchOptions {
  sources?: string[];
  includeBrowser: boolean;
  limitPerSource: number;
}

const jobSearch = async (s: JobSource, opts: SearchContext) => {
  try {
    const jobs = await s.search({
      criteria: opts.criteria,
      keywords: opts.keywords,
      limit: opts.limit,
    });
    log.info(`  ${s.name}: ${jobs.length} jobs`);
    return jobs;
  } catch (err) {
    log.warn(`  ${s.name} failed: ${(err as Error).message}`);
    return [];
  }
};

export async function search(
  rt: Runtime,
  profile: Profile,
  criteria: Criteria,
  opts: SearchOptions,
): Promise<Job[]> {
  const keywords = (
    criteria.keywords.length ? criteria.keywords : profile.searchKeywords
  ).slice(0, 8);
  const sources = selectSources(
    opts.sources,
    { dataDir: rt.config.dataDir, headless: rt.config.headless },
    opts.includeBrowser,
  );
  log.info(
    `search: ${sources.map((s) => s.name).join(", ")} for [${keywords.join(", ")}]`,
  );
  const found: Job[] = [];
  const httpRuns = sources
    .filter((s) => !s.needsBrowser)
    .map(async (s) => {
      const jobs = await jobSearch(s, {
        criteria,
        keywords,
        limit: opts.limitPerSource,
      });
      found.push(...jobs);
    });
  await Promise.all(httpRuns);
  for (const s of sources.filter((x) => x.needsBrowser)) {
    const jobs = await jobSearch(s, {
      criteria,
      keywords,
      limit: opts.limitPerSource,
    });
    found.push(...jobs);
  }
  const { added } = rt.store.upsertJobs(found);
  rt.store.save();
  log.info(`search: ${found.length} jobs fetched, ${added} new`);
  return found;
}

export async function match(
  rt: Runtime,
  profile: Profile,
  criteria: Criteria,
  maxJobs?: number,
): Promise<number> {
  const candidates = Object.values(rt.store.state.jobs).filter(
    (j) =>
      !rt.store.state.matches[j.id] &&
      !rt.store.isRejected(j.id) &&
      !rt.store.hasBeenApplied(j.id),
  );
  const { keep, rejected } = prefilter(candidates, criteria);
  for (const r of rejected) rt.store.reject(r.job.id, r.reason);
  rt.store.save();
  const toMatch = keep
    .toSorted((a, b) => (b.postedAt ?? "").localeCompare(a.postedAt ?? ""))
    .slice(0, maxJobs ?? criteria.maxJobsToMatch);
  log.info(
    `match: ${candidates.length} unscored → ${rejected.length} prefiltered out → scoring ${toMatch.length} with ${rt.config.model}`,
  );
  let applyCount = 0;
  await matchJobs(
    rt.llm,
    profile,
    criteria,
    toMatch,
    { model: rt.config.model },
    (m) => {
      rt.store.setMatch(m);
      rt.store.save();
      const j = rt.store.state.jobs[m.jobId]!;
      if (m.recommendation === "apply") applyCount++;
      log.info(
        `  ${String(m.score).padStart(3)} ${m.recommendation.padEnd(5)} ${j.title} @ ${j.company} [${j.source}] ${m.eligible ? "" : "(ineligible: " + m.eligibilityReason + ")"}`,
      );
    },
  );
  log.info(`match: ${applyCount} recommended to apply`);
  return applyCount;
}

export interface ApplyRunOptions {
  auto: boolean;
  max?: number;
}

export async function apply(
  rt: Runtime,
  profile: Profile,
  criteria: Criteria,
  cvPath: string,
  opts: ApplyRunOptions,
): Promise<void> {
  const pending = rt.store
    .pendingApplications(criteria.minMatchScore)
    .slice(0, opts.max ?? criteria.maxApplicationsPerRun);
  if (pending.length === 0) {
    log.info("apply: nothing pending");
    return;
  }
  log.info(
    `apply: ${pending.length} job(s), mode=${opts.auto ? "AUTO SUBMIT" : "review (stops before submit)"}`,
  );
  for (const job of pending) {
    log.info(
      `apply: ${job.title} @ ${job.company} — ${job.applyUrl ?? job.url}`,
    );
    const rec = await applyToJob(rt.llm, profile, criteria, job, {
      model: rt.config.model,
      dataDir: rt.config.dataDir,
      headless: rt.config.headless,
      cvPath,
      auto: opts.auto,
    });
    rt.store.recordApplication(rec);
    rt.store.save();
    log.info(`  → ${rec.status}: ${rec.notes}`);
  }
  const open = Object.values(rt.store.state.applications).filter(
    (a) => a.status === "needs_manual",
  ).length;
  if (!opts.auto && open > 0 && process.stdin.isTTY && !rt.config.headless) {
    log.info(
      `apply: ${open} tab(s) left open for your review. Press Enter to close the browser.`,
    );
    await new Promise<void>((resolve) =>
      process.stdin.once("data", () => resolve()),
    );
  }
  await closeBrowser();
}
