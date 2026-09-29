import fs from "node:fs";
import path from "node:path";
import { State, type ApplicationRecord, type Job, type MatchResult } from "../types.ts";

const EMPTY: State = { profileHash: null, jobs: {}, matches: {}, applications: {}, rejected: {} };

export class StateStore {
  readonly file: string;
  state: State;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, "state.json");
    fs.mkdirSync(dataDir, { recursive: true });
    this.state = fs.existsSync(this.file)
      ? State.parse(JSON.parse(fs.readFileSync(this.file, "utf8")))
      : structuredClone(EMPTY);
  }

  save(): void {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    fs.renameSync(tmp, this.file);
  }

  upsertJobs(jobs: Job[]): { added: number } {
    let added = 0;
    for (const job of jobs) {
      if (!this.state.jobs[job.id]) added++;
      this.state.jobs[job.id] = job;
    }
    return { added };
  }

  hasBeenApplied(jobId: string): boolean {
    const rec = this.state.applications[jobId];
    return rec !== undefined && rec.status !== "failed";
  }

  isRejected(jobId: string): boolean {
    return jobId in this.state.rejected;
  }

  reject(jobId: string, reason: string): void {
    this.state.rejected[jobId] = reason;
  }

  setMatch(match: MatchResult): void {
    this.state.matches[match.jobId] = match;
  }

  recordApplication(rec: ApplicationRecord): void {
    this.state.applications[rec.jobId] = rec;
  }

  /** Jobs that matched at or above the threshold and have not been applied to yet. */
  pendingApplications(minScore: number): Job[] {
    return Object.values(this.state.matches)
      .filter((m) => m.recommendation === "apply" && m.score >= minScore)
      .filter((m) => !this.hasBeenApplied(m.jobId))
      .toSorted((a, b) => b.score - a.score)
      .map((m) => this.state.jobs[m.jobId])
      .filter((j): j is Job => j !== undefined);
  }
}
