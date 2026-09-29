import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { StateStore } from "../src/store/state.ts";
import type { MatchResult } from "../src/types.ts";
import { job } from "./helpers.ts";

const dirs: string[] = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "jobbot-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const verdict = (
  jobId: string,
  score: number,
  recommendation: "apply" | "skip" = "apply",
): MatchResult => ({
  jobId,
  score,
  eligible: true,
  eligibilityReason: "",
  rateCheck: "pass",
  estimatedHourlyUsd: 40,
  employmentTypeOk: true,
  workModeOk: true,
  strengths: ["a"],
  gaps: [],
  recommendation,
});

describe("StateStore (SQLite)", () => {
  it("creates the database, persists across instances, and round-trips jobs exactly", () => {
    const dir = tmp();
    const s = new StateStore(dir);
    const j = job({
      id: "t:1",
      applyUrl: "https://apply",
      tags: ["x", "y"],
      salaryMin: 10,
      salaryPeriod: "hour",
    });
    expect(s.upsertJobs([j, j])).toEqual({ added: 1 });
    expect(s.upsertJobs([{ ...j, title: "Renamed" }])).toEqual({ added: 0 });
    s.setMatch(verdict("t:1", 90));
    s.reject("t:2", "why");
    s.setProfileHash("abc");
    s.close();
    expect(fs.existsSync(path.join(dir, "jobbot.sqlite"))).toBe(true);
    const again = new StateStore(dir);
    expect(again.getJob("t:1")).toEqual({ ...j, title: "Renamed" });
    expect(again.getMatch("t:1")).toEqual(verdict("t:1", 90));
    expect(again.pendingApplications(70).map((x) => x.id)).toEqual(["t:1"]);
    expect(again.isRejected("t:2")).toBe(true);
    expect(again.getProfileHash()).toBe("abc");
    expect(again.countJobs()).toBe(1);
  });
  it("excludes applied jobs from pending but retries failed and login_required ones", () => {
    const s = new StateStore(tmp());
    s.upsertJobs([job({ id: "t:1" }), job({ id: "t:2" }), job({ id: "t:3" }), job({ id: "t:4" })]);
    for (const id of ["t:1", "t:2", "t:3", "t:4"]) s.setMatch(verdict(id, 80));
    s.recordApplication({
      jobId: "t:3",
      status: "login_required",
      at: "2026-01-01T00:00:00Z",
      method: "test",
      notes: "",
      screenshot: null,
      coverLetterPath: null,
    });
    s.recordApplication({
      jobId: "t:4",
      status: "needs_manual",
      at: "2026-01-01T00:00:00Z",
      method: "test",
      notes: "",
      screenshot: null,
      coverLetterPath: null,
    });
    s.recordApplication({
      jobId: "t:1",
      status: "applied",
      at: "2026-01-01T00:00:00Z",
      method: "test",
      notes: "",
      screenshot: null,
      coverLetterPath: null,
    });
    s.recordApplication({
      jobId: "t:2",
      status: "failed",
      at: "2026-01-01T00:00:00Z",
      method: "test",
      notes: "",
      screenshot: null,
      coverLetterPath: null,
    });
    expect(s.hasBeenApplied("t:1")).toBe(true);
    expect(s.hasBeenApplied("t:2")).toBe(false);
    expect(s.hasBeenApplied("t:3")).toBe(false);
    expect(s.hasBeenApplied("t:4")).toBe(true);
    expect(
      s
        .pendingApplications(70)
        .map((x) => x.id)
        .toSorted(),
    ).toEqual(["t:2", "t:3"]);
    expect(s.countApplications()).toBe(4);
    expect(s.countApplications("applied")).toBe(1);
    expect(
      s
        .listApplications()
        .map((a) => a.jobId)
        .toSorted(),
    ).toEqual(["t:1", "t:2", "t:3", "t:4"]);
  });
  it("orders pending by score and respects the threshold", () => {
    const s = new StateStore(tmp());
    s.upsertJobs([job({ id: "a" }), job({ id: "b" }), job({ id: "c" })]);
    s.setMatch(verdict("a", 75));
    s.setMatch(verdict("b", 95));
    s.setMatch({ ...verdict("c", 99, "skip"), eligible: false });
    expect(s.pendingApplications(80).map((x) => x.id)).toEqual(["b"]);
    expect(s.pendingApplications(70).map((x) => x.id)).toEqual(["b", "a"]);
    expect(s.topMatches(2).map((m) => m.jobId)).toEqual(["c", "b"]);
  });
  it("re-qualifies stored verdicts when the threshold is lowered (rule lives in the query)", () => {
    const s = new StateStore(tmp());
    s.upsertJobs([job({ id: "a" }), job({ id: "b" })]);
    s.setMatch(verdict("a", 65, "skip"));
    s.setMatch({ ...verdict("b", 65, "skip"), rateCheck: "fail" });
    expect(s.pendingApplications(70)).toEqual([]);
    expect(s.pendingApplications(60).map((x) => x.id)).toEqual(["a"]);
    const listing = s.listMatches(60);
    expect(listing.map((m) => [m.jobId, m.qualifies, m.applicationStatus])).toEqual([
      ["a", true, null],
      ["b", false, null],
    ]);
  });
  it("updateApplicationStatus edits an existing record or creates a manual one", () => {
    const s = new StateStore(tmp());
    s.upsertJobs([job({ id: "a" }), job({ id: "b" })]);
    s.recordApplication({
      jobId: "a",
      status: "needs_manual",
      at: "2026-01-01T00:00:00Z",
      method: "greenhouse",
      notes: "stopped before submit",
      screenshot: null,
      coverLetterPath: null,
    });
    expect(s.updateApplicationStatus("a", "applied", "submitted by hand")).toBe(true);
    const a = s.listApplications().find((x) => x.jobId === "a")!;
    expect(a).toMatchObject({ status: "applied", method: "greenhouse" });
    expect(a.notes).toMatch(
      /^stopped before submit\n\[.{16} manual → applied\] submitted by hand$/,
    );
    expect(s.updateApplicationStatus("b", "skipped", "")).toBe(true);
    expect(s.listApplications().find((x) => x.jobId === "b")).toMatchObject({
      status: "skipped",
      method: "manual",
    });
    expect(s.updateApplicationStatus("nope", "applied", "")).toBe(false);
  });
  it("unscoredJobs leaves out matched, rejected, and applied jobs", () => {
    const s = new StateStore(tmp());
    s.upsertJobs(["a", "b", "c", "d", "e"].map((id) => job({ id })));
    s.setMatch(verdict("a", 50, "skip"));
    s.reject("b", "onsite");
    s.recordApplication({
      jobId: "c",
      status: "needs_manual",
      at: "2026-01-01T00:00:00Z",
      method: "t",
      notes: "",
      screenshot: null,
      coverLetterPath: null,
    });
    s.recordApplication({
      jobId: "d",
      status: "failed",
      at: "2026-01-01T00:00:00Z",
      method: "t",
      notes: "",
      screenshot: null,
      coverLetterPath: null,
    });
    expect(
      s
        .unscoredJobs()
        .map((j) => j.id)
        .toSorted(),
    ).toEqual(["d", "e"]);
    expect(s.rejectionReasons()).toEqual([{ reason: "onsite", n: 1 }]);
    expect(s.jobsBySource()).toEqual([{ source: "test", n: 5 }]);
  });
  it("rejects a corrupt row loudly instead of returning garbage", () => {
    const s = new StateStore(tmp());
    s.upsertJobs([job({ id: "t:1" })]);
    // simulate external corruption of an enum column
    (s as unknown as { db: { exec(sql: string): void } }).db.exec(
      "UPDATE jobs SET work_mode = 'spaceship'",
    );
    expect(() => s.getJob("t:1")).toThrow();
  });
});
