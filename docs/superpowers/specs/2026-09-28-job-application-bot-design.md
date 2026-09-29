# Job Application Bot — Design

Date: 2026-09-28

## Goal

A local CLI agent that reads the user's CV (`cv.pdf` or `resume.pdf`) and free-text
`instructions.txt`, discovers remote/hybrid jobs on popular portals, scores each job
description against the CV with Claude, and applies to the ones that pass the user's
rules (open to Pakistan-based or worldwide freelancers, fewer than 50 applicants, more
than 25 USD/hour, contract / full-time / part-time). Everything the bot does is
recorded so it never applies twice and the user can review what happened.

## Non-goals

- No hosted service, no UI. One machine, one user, a CLI and a JSON state file.
- No bypassing of bot protection or CAPTCHAs. Portals that block automation are
  driven through a visible browser with a persistent login profile, and anything the
  bot cannot finish is left as `needs_manual` with a screenshot.

## Pipeline

```
cv.pdf + instructions.txt
   │  profile   (pdf-parse → Claude structured output → data/profile.json)
   ▼
search      (sources: Remotive, RemoteOK, Himalayas, Arbeitnow, Jobicy, We Work Remotely,
   │         Working Nomads, LinkedIn guest search, Indeed [browser], Toptal [browser])
   ▼
prefilter   (deterministic: remote/hybrid, employment type, location eligibility,
   │         hourly-rate floor, applicant cap, dedupe, already-seen)
   ▼
match       (Claude scores JD vs profile: 0-100, eligibility, rate estimate, reasons)
   │
   ▼
apply       (Playwright: open apply URL, Claude maps form fields to profile answers,
   │         uploads CV, generates a cover letter, submits when --auto, else stops
   │         before submit for review)
   ▼
report      (data/state.json → console table / markdown)
```

`run` executes the whole pipeline. Each stage is also its own subcommand.

## Components

- `src/cli.ts` — commander entry point.
- `src/config.ts` — env + defaults. Model defaults to `claude-opus-5`.
- `src/types.ts` — zod schemas: `Profile`, `Criteria`, `Job`, `MatchResult`, `ApplicationRecord`.
- `src/profile/` — PDF text extraction, Claude extraction of profile + criteria from
  instructions.txt. Criteria defaults: remote+hybrid, all employment types, min 25 USD/h,
  max 50 applicants, unknown applicant count allowed, candidate country Pakistan.
- `src/sources/` — one file per portal implementing `JobSource { name; search(criteria): Promise<Job[]> }`.
  HTTP sources use `fetch`; LinkedIn uses the public guest endpoints (search list +
  job detail with applicant count). Indeed and Toptal use Playwright with the shared
  persistent browser profile because they block plain HTTP.
- `src/filter/` — `rate.ts` parses salary strings to USD/hour (annual ÷ 2080, monthly ÷ 173,
  daily ÷ 8); `prefilter.ts` applies criteria and drops jobs whose text restricts to a
  region the candidate is not in (e.g. "US only", "must be located in the EU").
- `src/match/matcher.ts` — one Claude call per job with the profile in a cached system
  prompt; structured output.
- `src/apply/` — `browser.ts` (persistent Chromium context), `formFiller.ts`
  (page → field inventory → Claude mapping → fill/upload/next/submit loop),
  `coverLetter.ts`, `applier.ts` (orchestration, status recording, screenshots).
- `src/store/state.ts` — JSON store at `data/state.json`: seen jobs, matches, applications.
- `src/report.ts` — summary.

## Applicant-count policy

Only LinkedIn exposes applicant counts. Jobs with a known count above the cap are dropped.
Jobs with an unknown count pass when `applyWhenApplicantsUnknown` is true (default),
because otherwise every non-LinkedIn portal would be excluded.

## Safety and control

- Default mode fills forms but stops before the final submit and records `needs_manual`
  with a screenshot; `--auto` submits.
- `maxApplicationsPerRun` (default 10) caps how many applications one run attempts.
- The bot never invents facts: the profile is extracted from the CV, custom question
  answers are generated from the profile only, and anything it cannot answer is left
  blank and flagged.
- LinkedIn and Indeed prohibit automation in their terms; the README states the risk.

## Testing

Unit tests (vitest) for rate parsing, prefilter rules, each source's response mapping
using recorded fixtures, the state store, and the matcher/form-mapper with a fake
Anthropic client. Live source checks are run manually and are not part of the suite.
