import { describe, expect, it } from "vitest";
import { prefilter, regionLock } from "../src/filter/prefilter.ts";
import { DEFAULT_CRITERIA } from "../src/types.ts";
import { job } from "./helpers.ts";

const reasons = (r: ReturnType<typeof prefilter>) => r.rejected.map((x) => x.reason);

describe("prefilter", () => {
  it("keeps a plain remote contract job with unknown pay and applicants", () => {
    const r = prefilter([job()], DEFAULT_CRITERIA);
    expect(r.keep).toHaveLength(1);
    expect(r.rejected).toHaveLength(0);
  });
  it("rejects onsite and internships but keeps unknown mode/type", () => {
    const r = prefilter(
      [
        job({ workMode: "onsite" }),
        job({ employmentType: "internship" }),
        job({ workMode: "unknown", employmentType: "unknown" }),
      ],
      DEFAULT_CRITERIA,
    );
    expect(r.keep).toHaveLength(1);
    expect(reasons(r)).toEqual(["work mode onsite", "employment type internship"]);
  });
  it("applies the applicant cap and the unknown-applicants policy", () => {
    expect(prefilter([job({ applicants: 50 })], DEFAULT_CRITERIA).keep).toHaveLength(0);
    expect(prefilter([job({ applicants: 49 })], DEFAULT_CRITERIA).keep).toHaveLength(1);
    const strict = { ...DEFAULT_CRITERIA, applyWhenApplicantsUnknown: false };
    expect(reasons(prefilter([job({ applicants: null })], strict))).toEqual([
      "applicant count unknown",
    ]);
  });
  it("rejects pay below the hourly floor using the best-case figure", () => {
    const low = job({ salaryMin: 10, salaryMax: 20, salaryCurrency: "USD", salaryPeriod: "hour" });
    const okRange = job({
      salaryMin: 15,
      salaryMax: 30,
      salaryCurrency: "USD",
      salaryPeriod: "hour",
    });
    const annual = job({
      salaryMin: 30_000,
      salaryMax: 40_000,
      salaryCurrency: "USD",
      salaryPeriod: "year",
    });
    const r = prefilter([low, okRange, annual], DEFAULT_CRITERIA);
    expect(r.keep.map((j) => j.id)).toEqual([okRange.id]);
    expect(reasons(r)[0]).toMatch(/pay ≈ \$20\/h/);
    expect(reasons(r)[1]).toMatch(/pay ≈ \$19\/h/);
  });
  it("rejects region-locked postings unless the candidate country is mentioned", () => {
    const usOnly = job({ location: "Remote, USA Only" });
    const mustLive = job({ description: "You must be located in the United States." });
    const openToPk = job({
      description: "US only... just kidding, we hire in Pakistan and India.",
    });
    const worldwide = job({
      location: "Anywhere in the World",
      description: "Must reside in the US or Canada is NOT required.",
    });
    const r = prefilter([usOnly, mustLive, openToPk, worldwide], DEFAULT_CRITERIA);
    expect(r.keep.map((j) => j.id)).toEqual([openToPk.id, worldwide.id]);
    expect(reasons(r)).toEqual(["restricted to United States", "restricted to United States"]);
  });
  it("dedupes by title+company and honours exclude keywords", () => {
    const a = job({ title: "Senior React Dev", company: "Acme" });
    const b = job({ title: "senior react dev", company: "ACME " });
    const c = job({ title: "PHP Developer", description: "Laravel and WordPress" });
    const r = prefilter([a, b, c], { ...DEFAULT_CRITERIA, excludeKeywords: ["wordpress"] });
    expect(r.keep).toEqual([a]);
    expect(reasons(r)).toEqual(["duplicate title+company", 'excluded keyword "wordpress"']);
  });
  it("handles an empty list", () => {
    expect(prefilter([], DEFAULT_CRITERIA)).toEqual({ keep: [], rejected: [] });
  });
});

describe("regionLock", () => {
  it("detects common lock phrasings", () => {
    expect(
      regionLock(
        job({ description: "Applicants must be authorized to work in the United States." }),
        "Pakistan",
      ),
    ).toBe("United States");
    expect(regionLock(job({ description: "EU-based candidates only" }), "Pakistan")).toBe("Europe");
    expect(
      regionLock(job({ description: "We are a UK based company hiring worldwide" }), "Pakistan"),
    ).toBe("United Kingdom");
  });
  it("returns null for open postings", () => {
    expect(regionLock(job({ description: "Work from anywhere." }), "Pakistan")).toBeNull();
  });
});
