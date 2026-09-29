import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { StateStore } from "../src/store/state.ts";
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

describe("StateStore", () => {
  it("starts empty, persists, and reloads", () => {
    const dir = tmp();
    const s = new StateStore(dir);
    const j = job({ id: "t:1" });
    expect(s.upsertJobs([j, j])).toEqual({ added: 1 });
    s.setMatch({
      jobId: "t:1",
      score: 90,
      eligible: true,
      eligibilityReason: "",
      rateCheck: "unknown",
      estimatedHourlyUsd: null,
      employmentTypeOk: true,
      workModeOk: true,
      strengths: [],
      gaps: [],
      recommendation: "apply",
    });
    s.reject("t:2", "why");
    s.save();
    const again = new StateStore(dir);
    expect(again.state.jobs["t:1"]).toEqual(j);
    expect(again.pendingApplications(70).map((x) => x.id)).toEqual(["t:1"]);
    expect(again.isRejected("t:2")).toBe(true);
  });
  it("excludes applied jobs from pending but allows retry after failure", () => {
    const s = new StateStore(tmp());
    s.upsertJobs([job({ id: "t:1" }), job({ id: "t:2" })]);
    for (const id of ["t:1", "t:2"])
      s.setMatch({
        jobId: id,
        score: 80,
        eligible: true,
        eligibilityReason: "",
        rateCheck: "pass",
        estimatedHourlyUsd: 40,
        employmentTypeOk: true,
        workModeOk: true,
        strengths: [],
        gaps: [],
        recommendation: "apply",
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
    expect(s.pendingApplications(70).map((x) => x.id)).toEqual(["t:2"]);
  });
  it("orders pending by score and respects the threshold", () => {
    const s = new StateStore(tmp());
    s.upsertJobs([job({ id: "a" }), job({ id: "b" }), job({ id: "c" })]);
    const m = (jobId: string, score: number, recommendation: "apply" | "skip" = "apply") =>
      s.setMatch({
        jobId,
        score,
        eligible: true,
        eligibilityReason: "",
        rateCheck: "pass",
        estimatedHourlyUsd: null,
        employmentTypeOk: true,
        workModeOk: true,
        strengths: [],
        gaps: [],
        recommendation,
      });
    m("a", 75);
    m("b", 95);
    m("c", 99, "skip");
    expect(s.pendingApplications(80).map((x) => x.id)).toEqual(["b"]);
    expect(s.pendingApplications(70).map((x) => x.id)).toEqual(["b", "a"]);
  });
  it("rejects a corrupt state file loudly", () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, "state.json"), '{"jobs": "nope"}');
    expect(() => new StateStore(dir)).toThrow();
  });
});
