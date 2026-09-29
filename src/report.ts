import type { StateStore } from "./store/state.ts";

export function renderReport(store: StateStore, minScore: number): string {
  const lines: string[] = [];
  lines.push("# Job bot report", "");
  lines.push(
    `Jobs seen: ${store.countJobs()}  |  prefiltered out: ${store.countRejected()}  |  matched: ${store.countMatches()}  |  queued to apply (score ≥ ${minScore}): ${store.pendingApplications(minScore).length}  |  applications: ${store.countApplications()}`,
  );
  lines.push("", "## Jobs by source", "");
  for (const { source, n } of store.jobsBySource()) lines.push(`- ${source}: ${n}`);

  lines.push(
    "",
    "## Top matches",
    "",
    "| score | apply? | eligible | rate | job | applicants | url |",
    "|---|---|---|---|---|---|---|",
  );
  for (const m of store.listMatches(minScore).slice(0, 25)) {
    const rate = `${m.rateCheck}${m.estimatedHourlyUsd ? ` ($${m.estimatedHourlyUsd.toFixed(0)}/h)` : ""}`;
    const why = m.eligible ? "yes" : `no: ${m.eligibilityReason.slice(0, 60)}`;
    lines.push(
      `| ${m.score} | ${m.qualifies ? "yes" : "no"} | ${why} | ${rate} | ${m.title} @ ${m.company} (${m.source}) | ${m.applicants ?? "?"} | ${m.url} |`,
    );
  }

  const apps = store.listApplications();
  lines.push("", "## Applications", "");
  if (apps.length === 0) lines.push("_none yet_");
  for (const a of apps) {
    const j = store.getJob(a.jobId);
    lines.push(
      `- **${a.status}** — ${j ? `${j.title} @ ${j.company}` : a.jobId} (${a.at.slice(0, 16)})  \n  ${a.notes}${a.screenshot ? `  \n  screenshot: ${a.screenshot}` : ""}`,
    );
  }

  lines.push("", "## Prefilter rejections", "");
  for (const { reason, n } of store.rejectionReasons()) lines.push(`- ${reason}: ${n}`);
  return lines.join("\n");
}
