import { z } from "zod";

const EmploymentType = z.enum([
  "full_time",
  "part_time",
  "contract",
  "freelance",
  "internship",
  "unknown",
]);
export type EmploymentType = z.infer<typeof EmploymentType>;

const WorkMode = z.enum(["remote", "hybrid", "onsite", "unknown"]);
export type WorkMode = z.infer<typeof WorkMode>;

const SalaryPeriod = z.enum(["hour", "day", "week", "month", "year"]);
export type SalaryPeriod = z.infer<typeof SalaryPeriod>;

const Experience = z.object({
  company: z.string(),
  title: z.string(),
  start: z.string().describe("YYYY-MM or YYYY, or empty if unknown"),
  end: z.string().describe("YYYY-MM, YYYY, 'present', or empty if unknown"),
  highlights: z.array(z.string()),
});

const Education = z.object({
  institution: z.string(),
  degree: z.string(),
  year: z.string(),
});

export const Profile = z.object({
  fullName: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string(),
  phone: z.string(),
  country: z.string(),
  city: z.string(),
  linkedinUrl: z.string(),
  githubUrl: z.string(),
  portfolioUrl: z.string(),
  headline: z.string().describe("One line, e.g. 'Senior Full-Stack Engineer (React, Node)'"),
  summary: z.string().describe("3-5 sentence professional summary in first person"),
  skills: z.array(z.string()),
  yearsOfExperience: z.number(),
  experience: z.array(Experience),
  education: z.array(Education),
  languages: z.array(z.string()),
  targetRoles: z.array(z.string()).describe("Job titles this person should search for"),
  searchKeywords: z.array(z.string()).describe("6-12 short search queries for job boards"),
});
export type Profile = z.infer<typeof Profile>;

export const Criteria = z.object({
  employmentTypes: z.array(EmploymentType),
  workModes: z.array(WorkMode),
  minHourlyUsd: z.number(),
  maxApplicants: z.number(),
  applyWhenApplicantsUnknown: z.boolean(),
  candidateCountry: z.string(),
  keywords: z.array(z.string()).describe("Search queries; empty means derive from the CV"),
  excludeKeywords: z.array(z.string()),
  minMatchScore: z.number(),
  maxApplicationsPerRun: z.number(),
  maxJobsToMatch: z.number(),
  extraInstructions: z.string().describe("Anything else the user asked for, verbatim summary"),
});
export type Criteria = z.infer<typeof Criteria>;

export const DEFAULT_CRITERIA: Criteria = {
  employmentTypes: ["full_time", "part_time", "contract", "freelance"],
  workModes: ["remote", "hybrid"],
  minHourlyUsd: 25,
  maxApplicants: 50,
  applyWhenApplicantsUnknown: true,
  candidateCountry: "Pakistan",
  keywords: [],
  excludeKeywords: [],
  minMatchScore: 70,
  maxApplicationsPerRun: 10,
  maxJobsToMatch: 60,
  extraInstructions: "",
};

export const Job = z.object({
  id: z.string().describe("source:externalId"),
  source: z.string(),
  title: z.string(),
  company: z.string(),
  url: z.string(),
  applyUrl: z.string().optional(),
  location: z.string(),
  workMode: WorkMode,
  employmentType: EmploymentType,
  salaryText: z.string(),
  salaryMin: z.number().nullable(),
  salaryMax: z.number().nullable(),
  salaryCurrency: z.string().nullable(),
  salaryPeriod: SalaryPeriod.nullable(),
  applicants: z.number().nullable(),
  postedAt: z.string().nullable(),
  description: z.string(),
  tags: z.array(z.string()),
});
export type Job = z.infer<typeof Job>;

export const MatchResult = z.object({
  jobId: z.string(),
  score: z.number().min(0).max(100),
  eligible: z
    .boolean()
    .describe("Candidate's location and work status are acceptable for this job"),
  eligibilityReason: z.string(),
  rateCheck: z.enum(["pass", "fail", "unknown"]),
  estimatedHourlyUsd: z.number().nullable(),
  employmentTypeOk: z.boolean(),
  workModeOk: z.boolean(),
  strengths: z.array(z.string()),
  gaps: z.array(z.string()),
  recommendation: z.enum(["apply", "skip"]),
});
export type MatchResult = z.infer<typeof MatchResult>;

export const ApplicationStatus = z.enum([
  "applied",
  "needs_manual",
  "login_required",
  "failed",
  "skipped",
]);
export type ApplicationStatus = z.infer<typeof ApplicationStatus>;

export const ApplicationRecord = z.object({
  jobId: z.string(),
  status: ApplicationStatus,
  at: z.string(),
  method: z.string(),
  notes: z.string(),
  screenshot: z.string().nullable(),
  coverLetterPath: z.string().nullable(),
});
export type ApplicationRecord = z.infer<typeof ApplicationRecord>;
