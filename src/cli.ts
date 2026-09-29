#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { Command } from "commander";
import { closeBrowser } from "./browser.ts";
import { DEFAULT_MODEL, loadConfig, loadDotenv, parseProvider } from "./config.ts";
import { log } from "./log.ts";
import { apply, createRuntime, ensureProfile, match, search } from "./pipeline.ts";
import { renderReport } from "./report.ts";

const splitList = (v: string) =>
  v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

async function main(): Promise<void> {
  loadDotenv(path.resolve(process.cwd(), ".env"));
  const config = loadConfig();
  const program = new Command()
    .name("jobbot")
    .description(
      "Reads your CV + instructions.txt, finds remote jobs, scores them with Claude, and applies.",
    )
    .option("--headless", "run the browser headless (default: visible)", false)
    .option("--provider <name>", "LLM provider: anthropic | ollama", parseProvider, config.provider)
    .option(
      "--model <id>",
      `model id (default: ${DEFAULT_MODEL.anthropic} / ${DEFAULT_MODEL.ollama})`,
    )
    .option("--ollama-host <url>", "Ollama server URL", config.ollamaHost)
    .hook("preAction", (cmd) => {
      const o = cmd.opts<{
        headless: boolean;
        provider: "anthropic" | "ollama";
        model?: string;
        ollamaHost: string;
      }>();
      config.headless = o.headless || config.headless;
      config.provider = o.provider;
      config.model = o.model ?? process.env.JOBBOT_MODEL ?? DEFAULT_MODEL[o.provider];
      config.ollamaHost = o.ollamaHost;
    });

  program
    .command("profile")
    .description(
      "Analyse cv.pdf/resume.pdf and instructions.txt into data/profile.json + data/criteria.json",
    )
    .option("-f, --force", "re-analyse even if unchanged", false)
    .action(async (o: { force: boolean }) => {
      const rt = createRuntime(config);
      const { profile, criteria } = await ensureProfile(rt, o.force);
      console.log(JSON.stringify({ profile, criteria }, null, 2));
    });

  program
    .command("search")
    .description("Fetch jobs from the portals into data/state.json")
    .option("-s, --sources <list>", "comma-separated sources (default: all)", splitList)
    .option("--browser", "also run browser-based sources (indeed, toptal)", false)
    .option("--limit <n>", "max jobs per source", (v) => Number.parseInt(v, 10), 100)
    .action(async (o: { sources?: string[]; browser: boolean; limit: number }) => {
      const rt = createRuntime(config);
      const { profile, criteria } = await ensureProfile(rt);
      await search(rt, profile, criteria, {
        ...(o.sources ? { sources: o.sources } : {}),
        includeBrowser: o.browser,
        limitPerSource: o.limit,
      });
      await closeBrowser();
    });

  program
    .command("match")
    .description("Prefilter and score fetched jobs against your profile")
    .option("--max <n>", "max jobs to score this run", (v) => Number.parseInt(v, 10))
    .action(async (o: { max?: number }) => {
      const rt = createRuntime(config);
      const { profile, criteria } = await ensureProfile(rt);
      await match(rt, profile, criteria, o.max);
    });

  program
    .command("apply")
    .description("Apply to recommended jobs (fills forms; stops before submit unless --auto)")
    .option("--auto", "submit applications without stopping for review", false)
    .option("--max <n>", "max applications this run", (v) => Number.parseInt(v, 10))
    .action(async (o: { auto: boolean; max?: number }) => {
      const rt = createRuntime(config);
      const { profile, criteria, cvPath } = await ensureProfile(rt);
      await apply(rt, profile, criteria, cvPath, {
        auto: o.auto,
        ...(o.max !== undefined ? { max: o.max } : {}),
      });
    });

  program
    .command("run")
    .description("Full pipeline: profile → search → match → apply → report")
    .option("-s, --sources <list>", "comma-separated sources (default: all)", splitList)
    .option("--browser", "also run browser-based sources (indeed, toptal)", false)
    .option("--limit <n>", "max jobs per source", (v) => Number.parseInt(v, 10), 100)
    .option("--auto", "submit applications without stopping for review", false)
    .option("--max <n>", "max applications this run", (v) => Number.parseInt(v, 10))
    .option("--no-apply", "stop after matching")
    .action(
      async (o: {
        sources?: string[];
        browser: boolean;
        limit: number;
        auto: boolean;
        max?: number;
        apply: boolean;
      }) => {
        const rt = createRuntime(config);
        const { profile, criteria, cvPath } = await ensureProfile(rt);
        await search(rt, profile, criteria, {
          ...(o.sources ? { sources: o.sources } : {}),
          includeBrowser: o.browser,
          limitPerSource: o.limit,
        });
        await match(rt, profile, criteria);
        if (o.apply)
          await apply(rt, profile, criteria, cvPath, {
            auto: o.auto,
            ...(o.max !== undefined ? { max: o.max } : {}),
          });
        else await closeBrowser();
        const report = renderReport(rt.store);
        fs.writeFileSync(path.join(config.dataDir, "report.md"), report);
        console.log(`\n${report}`);
      },
    );

  program
    .command("report")
    .description("Print a summary of jobs, matches, and applications")
    .action(() => {
      const rt = createRuntime(config);
      const report = renderReport(rt.store);
      fs.writeFileSync(path.join(config.dataDir, "report.md"), report);
      console.log(report);
    });

  await program.parseAsync(process.argv);
}

main().catch(async (err: unknown) => {
  log.error((err as Error).message);
  await closeBrowser().catch(() => null);
  process.exit(1);
});
