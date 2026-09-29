import type { EmploymentType, Job, WorkMode } from "../types.ts";
import { parseSalaryText } from "../filter/rate.ts";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

export async function fetchText(
  url: string,
  timeoutMs = 20_000,
  init: RequestInit = {},
): Promise<string> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "user-agent": USER_AGENT,
      accept: "application/json, text/html, application/xml;q=0.9, */*;q=0.8",
      ...init.headers,
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.text();
}

export async function fetchJson<T>(url: string, timeoutMs = 20_000): Promise<T> {
  return JSON.parse(await fetchText(url, timeoutMs)) as T;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  "#39": "'",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e.startsWith("#x")) return String.fromCodePoint(Number.parseInt(e.slice(2), 16));
    if (e.startsWith("#")) return String.fromCodePoint(Number.parseInt(e.slice(1), 10));
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Convert HTML to readable plain text, keeping list and paragraph breaks. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h\d|tr|section|article|ul|ol)>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t\r]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

export function normalizeEmployment(raw: string | string[] | null | undefined): EmploymentType {
  const t = (Array.isArray(raw) ? raw.join(" ") : (raw ?? "")).toLowerCase();
  if (!t) return "unknown";
  if (/intern/.test(t)) return "internship";
  if (/freelance/.test(t)) return "freelance";
  if (/contract|temporary|b2b/.test(t)) return "contract";
  if (/part[\s_-]?time/.test(t)) return "part_time";
  if (/full[\s_-]?time|permanent|employee/.test(t)) return "full_time";
  return "unknown";
}

export function normalizeWorkMode(
  raw: string | null | undefined,
  fallback: WorkMode = "unknown",
): WorkMode {
  const t = (raw ?? "").toLowerCase();
  if (/hybrid/.test(t)) return "hybrid";
  if (/remote|anywhere|worldwide|work from home|wfh|distributed/.test(t)) return "remote";
  if (/on[\s-]?site|in[\s-]?office|in[\s-]?person/.test(t)) return "onsite";
  return fallback;
}

export function keywordMatches(text: string, keywords: string[]): boolean {
  if (keywords.length === 0) return true;
  const hay = text.toLowerCase();
  return keywords.some((k) =>
    k
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .every((w) => hay.includes(w)),
  );
}

export function salaryFields(
  text: string,
): Pick<Job, "salaryText" | "salaryMin" | "salaryMax" | "salaryCurrency" | "salaryPeriod"> {
  const p = parseSalaryText(text);
  return {
    salaryText: text,
    salaryMin: p.min,
    salaryMax: p.max,
    salaryCurrency: p.currency,
    salaryPeriod: p.period,
  };
}

export function noSalary(): Pick<
  Job,
  "salaryText" | "salaryMin" | "salaryMax" | "salaryCurrency" | "salaryPeriod"
> {
  return {
    salaryText: "",
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: null,
  };
}

export function isoDate(v: string | number | null | undefined): string | null {
  if (v === null || v === undefined || v === "") return null;
  const d = typeof v === "number" ? new Date(v < 1e12 ? v * 1000 : v) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function truncate(s: string, max = 12_000): string {
  return s.length > max ? `${s.slice(0, max)}\n…[truncated]` : s;
}
