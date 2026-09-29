# job-application-bot

A local command-line agent that reads your CV, searches remote/hybrid jobs across job portals,
scores every posting against your CV with Claude, and applies to the ones that pass your rules.

What it does end to end:

1. **Profile** – reads `cv.pdf` (or `resume.pdf`) and `instructions.txt`, and asks Claude to
   produce a structured profile (skills, experience, contact details, search keywords) plus your
   search criteria (employment types, remote/hybrid, hourly floor, applicant cap, country).
2. **Search** – pulls postings from Remotive, RemoteOK, Himalayas, Arbeitnow, Jobicy,
   We Work Remotely, Working Nomads and LinkedIn (public guest endpoints, including applicant
   counts). With `--browser` it also drives a real Chromium window for Indeed and Toptal.
3. **Prefilter** – deterministic rules: remote/hybrid only, allowed employment types, pay at or
   above your hourly floor when stated, fewer than N applicants when known, no "US only" style
   region locks, no duplicates, nothing you already applied to.
4. **Match** – Claude scores each remaining posting 0-100 against your profile, checks
   eligibility for a Pakistan-based / worldwide freelancer, estimates the hourly rate, and
   recommends apply or skip.
5. **Apply** – opens the application in Chromium, inventories the form, asks Claude to map
   every field to a truthful answer from your profile, uploads your CV, writes a tailored cover
   letter, and walks through multi-step forms. By default it **stops before the final submit**
   so you can review; `--auto` submits.
6. **Report** – everything is tracked in `data/state.json` and summarised in `data/report.md`.

## Setup

Requirements: Node 24+, pnpm, an Anthropic API key.

```bash
pnpm install
pnpm exec playwright install chromium
cp .env.example .env          # put ANTHROPIC_API_KEY in .env (or run `ant auth login`)
```

Put your CV at `./cv.pdf` (or `./resume.pdf`) and edit `instructions.txt`. Plain English is fine:

```
Looking for contractual, full time, part time, remote or hybrid roles.
Base rate per hour should be more than 25 USD.
I am based in Pakistan; only consider jobs open to Pakistan or to freelancers from anywhere.
Only apply to jobs with fewer than 50 applicants.
```

## Usage

```bash
pnpm jobbot run                       # profile → search → match → apply (review mode) → report
pnpm jobbot run --auto --max 5        # submit up to 5 applications without stopping
pnpm jobbot run --browser             # also search Indeed and Toptal in a visible browser
pnpm jobbot run --no-apply            # stop after matching; read data/report.md

pnpm jobbot profile --force           # re-analyse the CV / instructions
pnpm jobbot search -s linkedin,remotive --limit 50
pnpm jobbot match --max 30
pnpm jobbot apply --max 3
pnpm jobbot report
```

Global flags: `--headless` (browser without a window), `--provider anthropic|ollama`,
`--model <id>` (default `claude-opus-5` for Anthropic, `llama3.1` for Ollama; or set `JOBBOT_MODEL`),
`--ollama-host <url>`.

### Using a local model with Ollama

No API key needed. Install [Ollama](https://ollama.com), pull a model, and point the bot at it:

```bash
ollama pull qwen3:4b-instruct             # 2.5 GB, the default for --provider ollama
pnpm jobbot run --provider ollama
# or in .env:  JOBBOT_PROVIDER=ollama  JOBBOT_MODEL=qwen3:4b-instruct  OLLAMA_HOST=http://localhost:11434
```

Model suggestions, measured on an Intel i9 MacBook Pro (CPU only, no GPU offload) scoring one
job posting:

| Model               | Size   | Time per job | Notes                                                        |
| ------------------- | ------ | ------------ | ------------------------------------------------------------ |
| `qwen3:4b-instruct` | 2.5 GB | see below    | default; instruct variant, no "thinking", 256k context       |
| `qwen2.5:7b`        | 4.7 GB | ~110 s       | reliable JSON, good reasoning                                |
| `qwen3:8b`          | 5.2 GB | ~140 s       | thinking is turned off by the bot; otherwise several minutes |
| `gemma3:4b`         | 3.3 GB | untested     | Google, 128k context                                         |
| `llama3.2:3b`       | 2.0 GB | untested     | fastest; weakest reasoning                                   |

The first call also loads the model from disk and warms Ollama's prompt cache; later calls
reuse the cached profile prefix. Model size barely changes speed on CPU because prompt
processing dominates, so pick the 4B model unless you have a GPU. Expect a full run to take a
while: 60 jobs × ~75 s is over an hour for the matching stage, plus 3-6 calls per application. Lower `maxJobsToMatch` in `data/criteria.json`
or pass `match --max 15` to keep runs short. Apple-silicon Macs or a machine with a GPU are
5-10× faster.

How the bot keeps local models workable:

- Replies are **streamed**, so a slow model never trips Node's 5-minute connection timeout. The
  bot only gives up if Ollama sends nothing at all for `OLLAMA_TIMEOUT_MS` (default 20 minutes).
- Requests run **one at a time** (Ollama serves one request at a time by default anyway).
- **Thinking is disabled** for models that support it (Qwen3, DeepSeek-R1); reasoning tokens
  multiply latency on CPU with little gain for this task.
- Inputs are trimmed to ~6,000 characters per call and a 16k context is requested
  (`OLLAMA_NUM_CTX`).
- Structured output uses Ollama's `format` parameter with the same JSON schemas as the Anthropic
  path; replies are validated and retried once.
- Ollama cannot read PDFs, so the CV is converted to text with pdf-parse. Scanned image-only
  PDFs extract nothing; use a text PDF or a `.txt` CV.
- Form filling and matching quality is lower than with Claude. Keep review mode (the default)
  with local models rather than `--auto`.

## Portal notes

| Portal                                                                             | How                              | Applicant count                                          | Apply                                                                                                    |
| ---------------------------------------------------------------------------------- | -------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Remotive, RemoteOK, Himalayas, Arbeitnow, Jobicy, We Work Remotely, Working Nomads | public APIs / RSS                | not published                                            | company ATS via Playwright                                                                               |
| LinkedIn                                                                           | public guest search + job detail | **yes** ("Over 200 applicants", "Be among the first 25") | Easy Apply or external ATS; needs you logged in                                                          |
| Indeed                                                                             | Playwright, `--browser`          | not published                                            | Indeed Apply; needs you logged in                                                                        |
| Toptal                                                                             | Playwright, `--browser`          | not published                                            | listed for information; applying requires joining the Toptal network, so these are always `needs_manual` |

Only LinkedIn publishes applicant counts, so the "fewer than 50 applicants" rule is enforced
strictly there. For other portals the count is unknown; the default
(`applyWhenApplicantsUnknown: true`) lets them through. Set it to `false` in
`data/criteria.json` to only apply where the count is known.

Indeed sits behind Cloudflare and frequently shows a "verify you are human" check to
automated browsers. The bot waits up to 90 seconds for you to solve it in the window. Toptal
is a vetted network, not an open board. LinkedIn's and Indeed's terms of service prohibit
automation; use `--browser` and LinkedIn applying at your own risk of account restrictions.

## Data

```
data/
  profile.json      structured profile extracted from your CV
  criteria.json     search criteria (edit by hand if you like)
  state.json        all jobs seen, prefilter rejections, match scores, applications
  cover-letters/    one tailored cover letter per application
  screenshots/      review / submitted / error screenshots
  report.md         latest summary
  browser-profile/  persistent Chromium profile (your logins)
```

Delete `data/state.json` to start fresh (the bot will re-see and possibly re-match every job).

## Development

```bash
pnpm check        # tsc --noEmit, oxlint, oxfmt --check, vitest
pnpm test
```

Tests cover salary parsing, prefilter rules, every portal's response mapping (recorded
fixtures), the LinkedIn HTML parsers, the state store, the matcher with a fake Claude client,
and the form filler against a real page in headless Chromium. Anything that talks to the live
API or portals is exercised manually, not in the suite.

## Costs

Each scored job is one Claude call with the profile cached; each application is roughly one call
per form page plus one for the cover letter. `maxJobsToMatch` (default 60) and
`maxApplicationsPerRun` (default 10) in `data/criteria.json` cap a run.
