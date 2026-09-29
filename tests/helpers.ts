import type { Job } from "../src/types.ts";

export function job(overrides: Partial<Job> = {}): Job {
  return {
    id: `test:${Math.random().toString(36).slice(2)}`,
    source: "test",
    title: "React Developer",
    company: `Acme-${Math.random().toString(36).slice(2, 7)}`,
    url: "https://example.com/job",
    location: "Remote",
    workMode: "remote",
    employmentType: "contract",
    salaryText: "",
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: null,
    applicants: null,
    postedAt: null,
    description: "Build things with React.",
    tags: [],
    ...overrides,
  };
}
