import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright";
import { newPage } from "../browser.ts";
import type { LLM } from "../llm/types.ts";
import { log } from "../log.ts";
import type { ApplicationRecord, Criteria, Job, Profile } from "../types.ts";
import { writeCoverLetter } from "./coverLetter.ts";
import { SUCCESS_RE, clickButton, executeActions, inventory, planStep } from "./formFiller.ts";

export interface ApplyOptions {
  model: string;
  dataDir: string;
  headless: boolean;
  cvPath: string;
  /** Submit without stopping for review. */
  auto: boolean;
  maxSteps?: number;
}

const MAX_STEPS = 8;
const now = () => new Date().toISOString();

function slug(s: string): string {
  return s
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 60);
}

async function screenshot(page: Page, dir: string, name: string): Promise<string | null> {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${name}-${Date.now()}.png`);
    await page.screenshot({ path: file, fullPage: false });
    return file;
  } catch {
    return null;
  }
}

export async function applyToJob(
  llm: LLM,
  profile: Profile,
  criteria: Criteria,
  job: Job,
  opts: ApplyOptions,
): Promise<ApplicationRecord> {
  const shotDir = path.join(opts.dataDir, "screenshots");
  const base = {
    jobId: job.id,
    method: job.source,
    coverLetterPath: null as string | null,
    screenshot: null as string | null,
  };

  if (job.source === "toptal") {
    return {
      ...base,
      status: "needs_manual",
      at: now(),
      notes:
        "Toptal jobs require membership in the Toptal network; apply via toptal.com after screening.",
    };
  }

  const coverLetter = await writeCoverLetter(llm, opts.model, profile, job);
  const clDir = path.join(opts.dataDir, "cover-letters");
  fs.mkdirSync(clDir, { recursive: true });
  const coverLetterPath = path.join(clDir, `${slug(job.id)}.txt`);
  fs.writeFileSync(coverLetterPath, coverLetter);
  base.coverLetterPath = coverLetterPath;

  let page = await newPage(opts.dataDir, opts.headless);
  const history: string[] = [];
  const unanswered = new Set<string>();
  const problems: string[] = [];
  try {
    await page.goto(job.applyUrl ?? job.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(2500);

    for (let step = 1; step <= (opts.maxSteps ?? MAX_STEPS); step++) {
      const inv = await inventory(page);
      if (SUCCESS_RE.test(inv.bodyText) && step > 1) {
        base.screenshot = await screenshot(page, shotDir, `${slug(job.id)}-submitted`);
        return {
          ...base,
          status: "applied",
          at: now(),
          notes: `Submitted after ${step - 1} step(s). ${problems.join("; ")}`.trim(),
        };
      }
      const plan = await planStep(llm, opts.model, inv, {
        profile,
        criteria,
        job,
        coverLetter,
        step,
        history,
      });
      log.info(`  step ${step}: ${plan.pageState} — ${plan.note}`);
      plan.unanswered.forEach((u) => unanswered.add(u));

      if (plan.pageState === "submitted") {
        base.screenshot = await screenshot(page, shotDir, `${slug(job.id)}-submitted`);
        return { ...base, status: "applied", at: now(), notes: plan.note };
      }
      if (plan.pageState === "already_applied")
        return {
          ...base,
          status: "skipped",
          at: now(),
          notes: "Already applied according to the page.",
        };
      if (plan.pageState === "login_required") {
        base.screenshot = await screenshot(page, shotDir, `${slug(job.id)}-login`);
        return {
          ...base,
          status: "login_required",
          at: now(),
          notes: `Login required at ${inv.url}. Sign in inside the bot's browser window, then run apply again; this job will be retried.`,
        };
      }
      if (plan.pageState === "blocked") {
        base.screenshot = await screenshot(page, shotDir, `${slug(job.id)}-blocked`);
        return {
          ...base,
          status: "needs_manual",
          at: now(),
          notes: `Bot check / CAPTCHA at ${inv.url}. ${plan.note}`,
        };
      }
      if (plan.pageState === "not_applicable") {
        return {
          ...base,
          status: "needs_manual",
          at: now(),
          notes: `Not a fillable application: ${plan.note} (${inv.url})`,
        };
      }

      problems.push(
        ...(await executeActions(page, plan, inv, { cvPath: opts.cvPath, coverLetterPath })),
      );
      history.push(
        `step ${step}: ${plan.fieldActions.filter((a) => a.action !== "skip").length} fields, ${plan.pageState}, clicked "${inv.buttons.find((b) => b.id === plan.nextButtonId)?.text ?? "nothing"}"`,
      );

      if (!plan.nextButtonId) {
        base.screenshot = await screenshot(page, shotDir, `${slug(job.id)}-stuck`);
        return {
          ...base,
          status: "needs_manual",
          at: now(),
          notes: `Filled fields but found no button to continue at ${inv.url}. ${plan.note}`,
        };
      }
      if (plan.nextButtonIsFinalSubmit) {
        if (unanswered.size > 0) {
          base.screenshot = await screenshot(page, shotDir, `${slug(job.id)}-review`);
          return {
            ...base,
            status: "needs_manual",
            at: now(),
            notes: `Ready to submit but ${unanswered.size} required question(s) need you: ${[...unanswered].join("; ")}`,
          };
        }
        if (!opts.auto) {
          base.screenshot = await screenshot(page, shotDir, `${slug(job.id)}-review`);
          return {
            ...base,
            status: "needs_manual",
            at: now(),
            notes: `Form filled and ready; stopped before final submit (run with --auto to submit). Left open at ${inv.url}`,
          };
        }
      }
      page = await clickButton(page, plan.nextButtonId);
      await page.waitForTimeout(2000);
      if (plan.nextButtonIsFinalSubmit) {
        const text = await page.evaluate(() => document.body?.innerText ?? "").catch(() => "");
        base.screenshot = await screenshot(page, shotDir, `${slug(job.id)}-after-submit`);
        if (SUCCESS_RE.test(text))
          return {
            ...base,
            status: "applied",
            at: now(),
            notes: `Submitted. ${problems.join("; ")}`.trim(),
          };
        return {
          ...base,
          status: "needs_manual",
          at: now(),
          notes: `Clicked submit but no confirmation text detected at ${page.url()}; check the screenshot.`,
        };
      }
    }
    base.screenshot = await screenshot(page, shotDir, `${slug(job.id)}-maxsteps`);
    return {
      ...base,
      status: "needs_manual",
      at: now(),
      notes: `Stopped after ${opts.maxSteps ?? MAX_STEPS} steps without reaching submit. ${history.join(" | ")}`,
    };
  } catch (err) {
    base.screenshot = await screenshot(page, shotDir, `${slug(job.id)}-error`);
    return {
      ...base,
      status: "failed",
      at: now(),
      notes: `Error: ${(err as Error).message.split("\n")[0]}`,
    };
  } finally {
    if (opts.auto) await page.close().catch(() => null);
  }
}
