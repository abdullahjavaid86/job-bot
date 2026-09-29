import fs from "node:fs";
import path from "node:path";
import process from "node:process";

export type Provider = "anthropic" | "ollama";

export const DEFAULT_MODEL: Record<Provider, string> = {
  anthropic: "claude-opus-5",
  ollama: "qwen3:4b-instruct",
};

export interface Config {
  provider: Provider;
  model: string;
  ollamaHost: string;
  ollamaNumCtx: number;
  ollamaTimeoutMs: number;
  dataDir: string;
  headless: boolean;
  cvPath: string | null;
  instructionsPath: string;
  requestTimeoutMs: number;
}

export function loadConfig(cwd = process.cwd()): Config {
  const dataDir = path.resolve(cwd, process.env.JOBBOT_DATA_DIR ?? "data");
  const provider = parseProvider(process.env.JOBBOT_PROVIDER ?? "anthropic");
  return {
    provider,
    model: process.env.JOBBOT_MODEL ?? DEFAULT_MODEL[provider],
    ollamaHost: process.env.OLLAMA_HOST ?? "http://localhost:11434",
    ollamaNumCtx: Number.parseInt(process.env.OLLAMA_NUM_CTX ?? "16384", 10),
    ollamaTimeoutMs: Number.parseInt(process.env.OLLAMA_TIMEOUT_MS ?? String(20 * 60_000), 10),
    dataDir,
    headless: (process.env.JOBBOT_HEADLESS ?? "false") === "true",
    cvPath: null,
    instructionsPath: path.resolve(cwd, "instructions.txt"),
    requestTimeoutMs: 20_000,
  };
}

export const CV_CANDIDATES = ["cv.pdf", "resume.pdf", "CV.pdf", "Resume.pdf"];

export function parseProvider(v: string): Provider {
  if (v === "anthropic" || v === "ollama") return v;
  throw new Error(`Unknown provider "${v}". Use "anthropic" or "ollama".`);
}

/**
 * Minimal .env parser: KEY=value lines, optional `export`, single/double quotes,
 * and `#` comments (a `#` inside quotes is kept). Later lines win.
 */
export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2]!;
    const quote = value[0];
    if (quote === '"' || quote === "'") {
      const end = value.indexOf(quote, 1);
      value = end > 0 ? value.slice(1, end) : value.slice(1);
    } else {
      value = value
        .replace(/\s+#.*$/, "")
        .replace(/^#.*$/, "")
        .trim();
    }
    out[m[1]!] = value;
  }
  return out;
}

export function loadDotenv(file: string, env: NodeJS.ProcessEnv = process.env): void {
  if (!fs.existsSync(file)) return;
  for (const [k, v] of Object.entries(parseDotenv(fs.readFileSync(file, "utf8")))) {
    if (env[k] === undefined) env[k] = v;
  }
}
