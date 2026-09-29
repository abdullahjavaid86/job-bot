import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { ApplicationStatus } from "../types.ts";
import type { StateStore } from "../store/state.ts";

export interface DashboardOptions {
  store: StateStore;
  dataDir: string;
  /** Read on every request so edits to criteria.json apply without a restart. */
  minScore: () => number;
  port: number;
}

export interface DashboardHandle {
  port: number;
  close(): void;
}

const PAGE = path.join(import.meta.dirname, "index.html");

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** Serve a file only if it lives under data/screenshots or data/cover-letters. */
function sendDataFile(res: http.ServerResponse, dataDir: string, requested: string): void {
  const resolved = path.resolve(requested);
  const allowed = ["screenshots", "cover-letters"].map(
    (d) => path.join(path.resolve(dataDir), d) + path.sep,
  );
  if (!allowed.some((dir) => resolved.startsWith(dir)) || !fs.existsSync(resolved)) {
    json(res, 404, { error: "file not found" });
    return;
  }
  const type = resolved.endsWith(".png") ? "image/png" : "text/plain; charset=utf-8";
  res.writeHead(200, { "content-type": type });
  fs.createReadStream(resolved).pipe(res);
}

export async function handleRequest(
  opts: DashboardOptions,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const { store } = opts;

  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(fs.readFileSync(PAGE));
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/summary") {
    const minScore = opts.minScore();
    json(res, 200, {
      minScore,
      jobs: store.countJobs(),
      rejected: store.countRejected(),
      matched: store.countMatches(),
      queued: store.pendingApplications(minScore).length,
      applications: store.countApplications(),
      bySource: store.jobsBySource(),
    });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/matches") {
    json(res, 200, store.listMatches(opts.minScore()));
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/applications") {
    json(
      res,
      200,
      store.listApplications().map((a) => {
        const job = store.getJob(a.jobId);
        return {
          jobId: a.jobId,
          status: a.status,
          at: a.at,
          method: a.method,
          notes: a.notes,
          screenshot: a.screenshot,
          coverLetterPath: a.coverLetterPath,
          title: job?.title ?? a.jobId,
          company: job?.company ?? "",
          source: job?.source ?? "",
          url: job?.applyUrl ?? job?.url ?? "",
          score: store.getMatch(a.jobId)?.score ?? null,
        };
      }),
    );
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/file") {
    sendDataFile(res, opts.dataDir, url.searchParams.get("path") ?? "");
    return;
  }
  const statusMatch = /^\/api\/applications\/(.+)\/status$/.exec(url.pathname);
  if (req.method === "POST" && statusMatch) {
    const raw = await readBody(req);
    let body: { status?: unknown; note?: unknown };
    try {
      body = JSON.parse(raw || "{}") as typeof body;
    } catch {
      json(res, 400, { error: "body must be JSON" });
      return;
    }
    const parsed = ApplicationStatus.safeParse(body.status);
    if (!parsed.success) {
      json(res, 400, { error: `status must be one of ${ApplicationStatus.options.join(", ")}` });
      return;
    }
    const jobId = decodeURIComponent(statusMatch[1]!);
    const ok = store.updateApplicationStatus(
      jobId,
      parsed.data,
      typeof body.note === "string" ? body.note : "",
    );
    if (!ok) {
      json(res, 404, { error: `unknown job ${jobId}` });
      return;
    }
    json(res, 200, { ok: true, jobId, status: parsed.data });
    return;
  }
  json(res, 404, { error: "not found" });
}

export function startDashboard(opts: DashboardOptions): Promise<DashboardHandle> {
  const server = http.createServer((req, res) => {
    handleRequest(opts, req, res).catch((err: unknown) => {
      json(res, 500, { error: (err as Error).message });
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : opts.port;
      resolve({ port, close: () => server.close() });
    });
  });
}
