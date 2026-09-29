import { describe, expect, it, vi } from "vitest";
import type { LLM } from "../src/llm/types.ts";
import {
  buildContext,
  decideRecommendation,
  matchJobs,
  type Verdict,
} from "../src/match/matcher.ts";
import { DEFAULT_CRITERIA, type Profile } from "../src/types.ts";
import { job } from "./helpers.ts";

const profile: Profile = {
  fullName: "Test Person",
  firstName: "Test",
  lastName: "Person",
  email: "t@example.com",
  phone: "+92 300 0000000",
  country: "Pakistan",
  city: "Lahore",
  linkedinUrl: "",
  githubUrl: "",
  portfolioUrl: "",
  headline: "React dev",
  summary: "",
  skills: ["React"],
  yearsOfExperience: 5,
  experience: [],
  education: [],
  languages: ["English"],
  targetRoles: ["React Developer"],
  searchKeywords: ["react"],
};

const verdict = (over: Partial<Verdict> = {}): Verdict => ({
  score: 80,
  eligible: true,
  eligibilityReason: "worldwide",
  rateCheck: "unknown",
  estimatedHourlyUsd: null,
  employmentTypeOk: true,
  workModeOk: true,
  strengths: ["React"],
  gaps: [],
  ...over,
});

describe("decideRecommendation", () => {
  it("applies only when every gate passes at the current threshold", () => {
    expect(decideRecommendation(verdict(), 70)).toBe("apply");
    expect(decideRecommendation(verdict({ score: 69 }), 70)).toBe("skip");
    expect(decideRecommendation(verdict({ score: 69 }), 60)).toBe("apply");
    expect(decideRecommendation(verdict({ eligible: false }), 70)).toBe("skip");
    expect(decideRecommendation(verdict({ rateCheck: "fail" }), 70)).toBe("skip");
    expect(decideRecommendation(verdict({ rateCheck: "pass" }), 70)).toBe("apply");
    expect(decideRecommendation(verdict({ employmentTypeOk: false }), 70)).toBe("skip");
    expect(decideRecommendation(verdict({ workModeOk: false }), 70)).toBe("skip");
  });
});

describe("matchJobs", () => {
  it("scores each job with the cached profile context and reports results", async () => {
    const structured = vi.fn<
      (req: { cachedContext: string; content: string; model: string }) => Promise<Verdict>
    >(async () => verdict());
    const llm = { structured, concurrency: 4, maxInputChars: 60_000 } as unknown as LLM;
    const jobs = [job({ id: "a" }), job({ id: "b" })];
    const seen: string[] = [];
    const results = await matchJobs(llm, profile, DEFAULT_CRITERIA, jobs, { model: "m" }, (m) =>
      seen.push(m.jobId),
    );
    expect(results.map((r) => r.jobId).toSorted()).toEqual(["a", "b"]);
    expect(results.every((r) => r.recommendation === "apply")).toBe(true);
    expect(seen.toSorted()).toEqual(["a", "b"]);
    const call = structured.mock.calls[0]![0] as {
      cachedContext: string;
      content: string;
      model: string;
    };
    expect(call.model).toBe("m");
    expect(call.cachedContext).toBe(buildContext(profile, DEFAULT_CRITERIA));
    expect(call.content).toContain("Build things with React.");
  });
  it("drops jobs whose scoring call fails instead of aborting the batch", async () => {
    let n = 0;
    const llm = {
      concurrency: 1,
      maxInputChars: 60_000,
      structured: async () => {
        n++;
        if (n === 1) throw new Error("boom");
        return verdict({ score: 55 });
      },
    } as unknown as LLM;
    const results = await matchJobs(
      llm,
      profile,
      DEFAULT_CRITERIA,
      [job({ id: "a" }), job({ id: "b" })],
      { model: "m", concurrency: 1 },
    );
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ jobId: "b", score: 55, recommendation: "skip" });
  });
  it("handles an empty job list", async () => {
    const llm = { structured: vi.fn(), concurrency: 4, maxInputChars: 60_000 } as unknown as LLM;
    expect(await matchJobs(llm, profile, DEFAULT_CRITERIA, [], { model: "m" })).toEqual([]);
  });
});
