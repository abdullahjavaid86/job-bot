import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startDashboard, type DashboardHandle } from "../src/dashboard/server.ts";
import { StateStore } from "../src/store/state.ts";
import { job } from "./helpers.ts";

let dir: string;
let store: StateStore;
let server: DashboardHandle;
const base = () => `http://127.0.0.1:${server.port}`;
const v = (jobId: string, score: number, eligible = true) => ({
  jobId,
  score,
  eligible,
  eligibilityReason: eligible ? "" : "EU only",
  rateCheck: "unknown" as const,
  estimatedHourlyUsd: null,
  employmentTypeOk: true,
  workModeOk: true,
  strengths: [],
  gaps: [],
  recommendation: "skip" as const,
});

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "jobbot-dash-"));
  store = new StateStore(dir);
  store.upsertJobs([
    job({ id: "a", title: "A" }),
    job({ id: "b", title: "B" }),
    job({ id: "c", title: "C" }),
  ]);
  store.setMatch(v("a", 90));
  store.setMatch(v("b", 65));
  store.setMatch(v("c", 80, false));
  fs.mkdirSync(path.join(dir, "screenshots"));
  fs.writeFileSync(path.join(dir, "screenshots", "a.png"), "png");
  store.recordApplication({
    jobId: "a",
    status: "login_required",
    at: "2026-01-01T00:00:00Z",
    method: "linkedin",
    notes: "Login required",
    screenshot: path.join(dir, "screenshots", "a.png"),
    coverLetterPath: null,
  });
  server = await startDashboard({ store, dataDir: dir, minScore: () => 70, port: 0 });
});
afterAll(() => {
  server.close();
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("dashboard server", () => {
  it("serves the page", async () => {
    const res = await fetch(`${base()}/`);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("Job bot review");
  });
  it("summarises with the current threshold", async () => {
    const s = (await (await fetch(`${base()}/api/summary`)).json()) as Record<string, unknown>;
    expect(s).toMatchObject({ minScore: 70, jobs: 3, matched: 3, queued: 1, applications: 1 });
  });
  it("lists matches with qualification and application status", async () => {
    const m = (await (await fetch(`${base()}/api/matches`)).json()) as Array<
      Record<string, unknown>
    >;
    expect(m.map((x) => [x.jobId, x.qualifies, x.applicationStatus])).toEqual([
      ["a", true, "login_required"],
      ["c", false, null],
      ["b", false, null],
    ]);
  });
  it("lists applications joined with job info", async () => {
    const a = (await (await fetch(`${base()}/api/applications`)).json()) as Array<
      Record<string, unknown>
    >;
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ jobId: "a", title: "A", status: "login_required", score: 90 });
  });
  it("serves screenshots only from the data directory", async () => {
    const ok = await fetch(
      `${base()}/api/file?path=${encodeURIComponent(path.join(dir, "screenshots", "a.png"))}`,
    );
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/png");
    const outside = await fetch(
      `${base()}/api/file?path=${encodeURIComponent(path.join(dir, "..", "etc-passwd"))}`,
    );
    expect(outside.status).toBe(404);
    const traversal = await fetch(
      `${base()}/api/file?path=${encodeURIComponent(path.join(dir, "screenshots", "..", "..", "x"))}`,
    );
    expect(traversal.status).toBe(404);
  });
  it("changes an application status with a note, and creates one for a scored job", async () => {
    const post = (id: string, body: unknown) =>
      fetch(`${base()}/api/applications/${encodeURIComponent(id)}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    expect((await post("a", { status: "applied", note: "did it by hand" })).status).toBe(200);
    const a = store.listApplications().find((x) => x.jobId === "a")!;
    expect(a.status).toBe("applied");
    expect(a.notes).toMatch(/Login required\n\[.* manual → applied\] did it by hand/);
    expect((await post("b", { status: "skipped" })).status).toBe(200);
    expect(store.listApplications().find((x) => x.jobId === "b")).toMatchObject({
      status: "skipped",
      method: "manual",
    });
    expect((await post("zzz", { status: "applied" })).status).toBe(404);
    expect((await post("a", { status: "bogus" })).status).toBe(400);
    expect((await post("a", {})).status).toBe(400);
    const bad = await fetch(`${base()}/api/applications/a/status`, {
      method: "POST",
      body: "{not json",
    });
    expect(bad.status).toBe(400);
  });
  it("404s unknown routes", async () => {
    expect((await fetch(`${base()}/api/nope`)).status).toBe(404);
  });
});
