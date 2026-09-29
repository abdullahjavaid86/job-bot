import type { StateStore } from "./store/state.ts";

export function renderReport(store: StateStore): string {
  const { jobs, matches, applications, rejected } = store.state;
  const lines: string[] = [];
  const bySource = new Map<string, number>();
  for (const j of Object.values(jobs)) bySource.set(j.source, (bySource.get(j.source) ?? 0) + 1);

  lines.push("# Job bot report", "");
  lines.push(
    `Jobs seen: ${Object.keys(jobs).length}  |  prefiltered out: ${Object.keys(rejected).length}  |  matched: ${Object.keys(matches).length}  |  applications: ${Object.keys(applications).length}`,
  );
  lines.push("", "## Jobs by source", "");
  for (const [s, n] of [...bySource.entries()].toSorted((a, b) => b[1] - a[1]))
    lines.push(`- ${s}: ${n}`);

  const top = Object.values(matches)
    .toSorted((a, b) => b.score - a.score)
    .slice(0, 25);
  lines.push(
    "",
    "## Top matches",
    "",
    "| score | rec | eligible | rate | job | applicants | url |",
    "|---|---|---|---|---|---|---|",
  );
  for (const m of top) {
    const j = jobs[m.jobId];
    if (!j) continue;
    lines.push(
      `| ${m.score} | ${m.recommendation} | ${m.eligible ? "yes" : "no"} | ${m.rateCheck}${m.estimatedHourlyUsd ? ` ($${m.estimatedHourlyUsd.toFixed(0)}/h)` : ""} | ${j.title} @ ${j.company} (${j.source}) | ${j.applicants ?? "?"} | ${j.url} |`,
    );
  }

  const apps = Object.values(applications).toSorted((a, b) => b.at.localeCompare(a.at));
  lines.push("", "## Applications", "");
  if (apps.length === 0) lines.push("_none yet_");
  for (const a of apps) {
    const j = jobs[a.jobId];
    lines.push(
      `- **${a.status}** — ${j ? `${j.title} @ ${j.company}` : a.jobId} (${a.at.slice(0, 16)})  \n  ${a.notes}${a.screenshot ? `  \n  screenshot: ${a.screenshot}` : ""}`,
    );
  }

  const reasons = new Map<string, number>();
  for (const r of Object.values(rejected)) {
    const key = r.replace(/\d+/g, "N");
    reasons.set(key, (reasons.get(key) ?? 0) + 1);
  }
  lines.push("", "## Prefilter rejections", "");
  for (const [r, n] of [...reasons.entries()].toSorted((a, b) => b[1] - a[1]).slice(0, 15))
    lines.push(`- ${r}: ${n}`);
  return lines.join("\n");
}
