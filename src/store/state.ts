import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  ApplicationRecord,
  Job,
  MatchResult,
  type ApplicationStatus,
  type EmploymentType,
  type SalaryPeriod,
  type WorkMode,
} from "../types.ts";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  title TEXT NOT NULL,
  company TEXT NOT NULL,
  url TEXT NOT NULL,
  apply_url TEXT,
  location TEXT NOT NULL,
  work_mode TEXT NOT NULL,
  employment_type TEXT NOT NULL,
  salary_text TEXT NOT NULL,
  salary_min REAL,
  salary_max REAL,
  salary_currency TEXT,
  salary_period TEXT,
  applicants INTEGER,
  posted_at TEXT,
  description TEXT NOT NULL,
  tags TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_source ON jobs(source);
CREATE TABLE IF NOT EXISTS matches (
  job_id TEXT PRIMARY KEY REFERENCES jobs(id),
  score REAL NOT NULL,
  eligible INTEGER NOT NULL,
  eligibility_reason TEXT NOT NULL,
  rate_check TEXT NOT NULL,
  estimated_hourly_usd REAL,
  employment_type_ok INTEGER NOT NULL,
  work_mode_ok INTEGER NOT NULL,
  strengths TEXT NOT NULL,
  gaps TEXT NOT NULL,
  recommendation TEXT NOT NULL,
  matched_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS applications (
  job_id TEXT PRIMARY KEY REFERENCES jobs(id),
  status TEXT NOT NULL,
  at TEXT NOT NULL,
  method TEXT NOT NULL,
  notes TEXT NOT NULL,
  screenshot TEXT,
  cover_letter_path TEXT
);
CREATE TABLE IF NOT EXISTS rejected (
  job_id TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  at TEXT NOT NULL
);
`;

type Row = Record<string, string | number | null>;

const now = () => new Date().toISOString();

function rowToJob(r: Row): Job {
  return Job.parse({
    id: r.id,
    source: r.source,
    title: r.title,
    company: r.company,
    url: r.url,
    ...(r.apply_url ? { applyUrl: r.apply_url } : {}),
    location: r.location,
    workMode: r.work_mode as WorkMode,
    employmentType: r.employment_type as EmploymentType,
    salaryText: r.salary_text,
    salaryMin: r.salary_min,
    salaryMax: r.salary_max,
    salaryCurrency: r.salary_currency,
    salaryPeriod: r.salary_period as SalaryPeriod | null,
    applicants: r.applicants,
    postedAt: r.posted_at,
    description: r.description,
    tags: JSON.parse(String(r.tags)) as string[],
  });
}

function rowToMatch(r: Row): MatchResult {
  return MatchResult.parse({
    jobId: r.job_id,
    score: r.score,
    eligible: r.eligible === 1,
    eligibilityReason: r.eligibility_reason,
    rateCheck: r.rate_check,
    estimatedHourlyUsd: r.estimated_hourly_usd,
    employmentTypeOk: r.employment_type_ok === 1,
    workModeOk: r.work_mode_ok === 1,
    strengths: JSON.parse(String(r.strengths)) as string[],
    gaps: JSON.parse(String(r.gaps)) as string[],
    recommendation: r.recommendation,
  });
}

function rowToApplication(r: Row): ApplicationRecord {
  return ApplicationRecord.parse({
    jobId: r.job_id,
    status: r.status,
    at: r.at,
    method: r.method,
    notes: r.notes,
    screenshot: r.screenshot,
    coverLetterPath: r.cover_letter_path,
  });
}

/** All bot state in one SQLite file: jobs seen, prefilter rejections, match verdicts, applications. */
export class StateStore {
  readonly file: string;
  private readonly db: DatabaseSync;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.file = path.join(dataDir, "jobbot.sqlite");
    this.db = new DatabaseSync(this.file);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  getProfileHash(): string | null {
    const r = this.db.prepare("SELECT value FROM meta WHERE key = 'profileHash'").get() as
      | Row
      | undefined;
    return r ? String(r.value) : null;
  }

  setProfileHash(hash: string): void {
    this.db
      .prepare(
        "INSERT INTO meta (key, value) VALUES ('profileHash', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(hash);
  }

  upsertJobs(jobs: Job[]): { added: number } {
    const stmt = this.db.prepare(`
      INSERT INTO jobs (id, source, title, company, url, apply_url, location, work_mode, employment_type,
        salary_text, salary_min, salary_max, salary_currency, salary_period, applicants, posted_at,
        description, tags, first_seen, last_seen)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title, company = excluded.company, url = excluded.url, apply_url = excluded.apply_url,
        location = excluded.location, work_mode = excluded.work_mode, employment_type = excluded.employment_type,
        salary_text = excluded.salary_text, salary_min = excluded.salary_min, salary_max = excluded.salary_max,
        salary_currency = excluded.salary_currency, salary_period = excluded.salary_period,
        applicants = excluded.applicants, posted_at = excluded.posted_at, description = excluded.description,
        tags = excluded.tags, last_seen = excluded.last_seen`);
    const exists = this.db.prepare("SELECT 1 FROM jobs WHERE id = ?");
    let added = 0;
    const ts = now();
    this.db.exec("BEGIN");
    try {
      for (const j of jobs) {
        if (!exists.get(j.id)) added++;
        stmt.run(
          j.id,
          j.source,
          j.title,
          j.company,
          j.url,
          j.applyUrl ?? null,
          j.location,
          j.workMode,
          j.employmentType,
          j.salaryText,
          j.salaryMin,
          j.salaryMax,
          j.salaryCurrency,
          j.salaryPeriod,
          j.applicants,
          j.postedAt,
          j.description,
          JSON.stringify(j.tags),
          ts,
          ts,
        );
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
    return { added };
  }

  getJob(id: string): Job | undefined {
    const r = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Row | undefined;
    return r ? rowToJob(r) : undefined;
  }

  countJobs(): number {
    return Number((this.db.prepare("SELECT COUNT(*) n FROM jobs").get() as Row).n);
  }

  jobsBySource(): Array<{ source: string; n: number }> {
    return (
      this.db
        .prepare("SELECT source, COUNT(*) n FROM jobs GROUP BY source ORDER BY n DESC")
        .all() as Row[]
    ).map((r) => ({ source: String(r.source), n: Number(r.n) }));
  }

  /** Jobs with no verdict, not prefiltered out, and not already applied to. */
  unscoredJobs(): Job[] {
    const rows = this.db
      .prepare(`SELECT j.* FROM jobs j
        LEFT JOIN matches m ON m.job_id = j.id
        LEFT JOIN rejected r ON r.job_id = j.id
        LEFT JOIN applications a ON a.job_id = j.id AND a.status NOT IN ('failed', 'login_required')
        WHERE m.job_id IS NULL AND r.job_id IS NULL AND a.job_id IS NULL`)
      .all() as Row[];
    return rows.map(rowToJob);
  }

  hasBeenApplied(jobId: string): boolean {
    return Boolean(
      this.db
        .prepare(
          "SELECT 1 FROM applications WHERE job_id = ? AND status NOT IN ('failed', 'login_required')",
        )
        .get(jobId),
    );
  }

  isRejected(jobId: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM rejected WHERE job_id = ?").get(jobId));
  }

  reject(jobId: string, reason: string): void {
    this.db
      .prepare(
        "INSERT INTO rejected (job_id, reason, at) VALUES (?, ?, ?) ON CONFLICT(job_id) DO UPDATE SET reason = excluded.reason",
      )
      .run(jobId, reason, now());
  }

  countRejected(): number {
    return Number((this.db.prepare("SELECT COUNT(*) n FROM rejected").get() as Row).n);
  }

  /** Rejection reasons with digits collapsed, most common first. */
  rejectionReasons(limit = 15): Array<{ reason: string; n: number }> {
    const counts = new Map<string, number>();
    for (const r of this.db.prepare("SELECT reason FROM rejected").all() as Row[]) {
      const key = String(r.reason).replace(/\d+/g, "N");
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([reason, n]) => ({ reason, n }))
      .toSorted((a, b) => b.n - a.n)
      .slice(0, limit);
  }

  setMatch(m: MatchResult): void {
    this.db
      .prepare(`INSERT INTO matches (job_id, score, eligible, eligibility_reason, rate_check, estimated_hourly_usd,
          employment_type_ok, work_mode_ok, strengths, gaps, recommendation, matched_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(job_id) DO UPDATE SET score = excluded.score, eligible = excluded.eligible,
          eligibility_reason = excluded.eligibility_reason, rate_check = excluded.rate_check,
          estimated_hourly_usd = excluded.estimated_hourly_usd, employment_type_ok = excluded.employment_type_ok,
          work_mode_ok = excluded.work_mode_ok, strengths = excluded.strengths, gaps = excluded.gaps,
          recommendation = excluded.recommendation, matched_at = excluded.matched_at`)
      .run(
        m.jobId,
        m.score,
        m.eligible ? 1 : 0,
        m.eligibilityReason,
        m.rateCheck,
        m.estimatedHourlyUsd,
        m.employmentTypeOk ? 1 : 0,
        m.workModeOk ? 1 : 0,
        JSON.stringify(m.strengths),
        JSON.stringify(m.gaps),
        m.recommendation,
        now(),
      );
  }

  getMatch(jobId: string): MatchResult | undefined {
    const r = this.db.prepare("SELECT * FROM matches WHERE job_id = ?").get(jobId) as
      | Row
      | undefined;
    return r ? rowToMatch(r) : undefined;
  }

  countMatches(): number {
    return Number((this.db.prepare("SELECT COUNT(*) n FROM matches").get() as Row).n);
  }

  topMatches(limit = 25): MatchResult[] {
    return (
      this.db.prepare("SELECT * FROM matches ORDER BY score DESC LIMIT ?").all(limit) as Row[]
    ).map(rowToMatch);
  }

  recordApplication(rec: ApplicationRecord): void {
    this.db
      .prepare(`INSERT INTO applications (job_id, status, at, method, notes, screenshot, cover_letter_path)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(job_id) DO UPDATE SET status = excluded.status, at = excluded.at, method = excluded.method,
          notes = excluded.notes, screenshot = excluded.screenshot, cover_letter_path = excluded.cover_letter_path`)
      .run(
        rec.jobId,
        rec.status,
        rec.at,
        rec.method,
        rec.notes,
        rec.screenshot,
        rec.coverLetterPath,
      );
  }

  listApplications(): ApplicationRecord[] {
    return (this.db.prepare("SELECT * FROM applications ORDER BY at DESC").all() as Row[]).map(
      rowToApplication,
    );
  }

  countApplications(status?: ApplicationStatus): number {
    const r = status
      ? this.db.prepare("SELECT COUNT(*) n FROM applications WHERE status = ?").get(status)
      : this.db.prepare("SELECT COUNT(*) n FROM applications").get();
    return Number((r as Row).n);
  }

  /**
   * Jobs that qualify for an application, best first, not yet applied to.
   * Same rule as decideRecommendation() in the matcher, evaluated against the current threshold.
   */
  pendingApplications(minScore: number): Job[] {
    const rows = this.db
      .prepare(`SELECT j.* FROM matches m JOIN jobs j ON j.id = m.job_id
        LEFT JOIN applications a ON a.job_id = j.id AND a.status NOT IN ('failed', 'login_required')
        WHERE ${QUALIFIES} AND a.job_id IS NULL
        ORDER BY m.score DESC`)
      .all(minScore) as Row[];
    return rows.map(rowToJob);
  }

  /** Every scored job with its verdict, current qualification, and application status (for the dashboard). */
  listMatches(minScore: number): MatchListing[] {
    const rows = this.db
      .prepare(`SELECT j.id, j.title, j.company, j.source, j.url, j.apply_url, j.location, j.applicants,
          m.score, m.eligible, m.eligibility_reason, m.rate_check, m.estimated_hourly_usd,
          m.employment_type_ok, m.work_mode_ok, m.strengths, m.gaps, m.matched_at,
          (${QUALIFIES}) AS qualifies, a.status AS app_status
        FROM matches m JOIN jobs j ON j.id = m.job_id
        LEFT JOIN applications a ON a.job_id = j.id
        ORDER BY m.score DESC, j.id`)
      .all(minScore) as Row[];
    return rows.map((r) => ({
      jobId: String(r.id),
      title: String(r.title),
      company: String(r.company),
      source: String(r.source),
      url: String(r.url),
      applyUrl: r.apply_url ? String(r.apply_url) : null,
      location: String(r.location),
      applicants: r.applicants === null ? null : Number(r.applicants),
      score: Number(r.score),
      eligible: r.eligible === 1,
      eligibilityReason: String(r.eligibility_reason),
      rateCheck: String(r.rate_check) as MatchResult["rateCheck"],
      estimatedHourlyUsd: r.estimated_hourly_usd === null ? null : Number(r.estimated_hourly_usd),
      employmentTypeOk: r.employment_type_ok === 1,
      workModeOk: r.work_mode_ok === 1,
      strengths: JSON.parse(String(r.strengths)) as string[],
      gaps: JSON.parse(String(r.gaps)) as string[],
      matchedAt: String(r.matched_at),
      qualifies: r.qualifies === 1,
      applicationStatus: r.app_status === null ? null : (String(r.app_status) as ApplicationStatus),
    }));
  }

  /** Human override from the dashboard: change an application's status and append a note. */
  updateApplicationStatus(jobId: string, status: ApplicationStatus, note: string): boolean {
    const existing = this.db
      .prepare("SELECT notes FROM applications WHERE job_id = ?")
      .get(jobId) as Row | undefined;
    const stamp = `[${now().slice(0, 16)} manual → ${status}]${note ? ` ${note}` : ""}`;
    if (existing) {
      this.db
        .prepare("UPDATE applications SET status = ?, at = ?, notes = ? WHERE job_id = ?")
        .run(status, now(), `${String(existing.notes)}\n${stamp}`.trim(), jobId);
      return true;
    }
    if (!this.getJob(jobId)) return false;
    this.recordApplication({
      jobId,
      status,
      at: now(),
      method: "manual",
      notes: stamp,
      screenshot: null,
      coverLetterPath: null,
    });
    return true;
  }
}

/** SQL form of the apply rule; bind the score threshold as the single parameter. */
const QUALIFIES =
  "m.eligible = 1 AND m.rate_check != 'fail' AND m.employment_type_ok = 1 AND m.work_mode_ok = 1 AND m.score >= ?";

export interface MatchListing {
  jobId: string;
  title: string;
  company: string;
  source: string;
  url: string;
  applyUrl: string | null;
  location: string;
  applicants: number | null;
  score: number;
  eligible: boolean;
  eligibilityReason: string;
  rateCheck: MatchResult["rateCheck"];
  estimatedHourlyUsd: number | null;
  employmentTypeOk: boolean;
  workModeOk: boolean;
  strengths: string[];
  gaps: string[];
  matchedAt: string;
  qualifies: boolean;
  applicationStatus: ApplicationStatus | null;
}
