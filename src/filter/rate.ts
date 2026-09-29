import type { SalaryPeriod } from "../types.ts";

const HOURS_PER: Record<SalaryPeriod, number> = {
  hour: 1,
  day: 8,
  week: 40,
  month: 173,
  year: 2080,
};

/** Rough conversion table to USD; good enough for a threshold check. */
const TO_USD: Record<string, number> = {
  USD: 1,
  EUR: 1.08,
  GBP: 1.27,
  CAD: 0.73,
  AUD: 0.66,
  CHF: 1.12,
  INR: 0.012,
  PKR: 0.0036,
  SGD: 0.74,
  AED: 0.27,
  PLN: 0.25,
  SEK: 0.095,
  NOK: 0.093,
  DKK: 0.145,
  BRL: 0.18,
  MXN: 0.055,
  JPY: 0.0067,
  ZAR: 0.055,
  NZD: 0.6,
};

const SYMBOLS: Record<string, string> = {
  $: "USD",
  "€": "EUR",
  "£": "GBP",
  "₹": "INR",
  "₨": "PKR",
  "¥": "JPY",
};

export interface ParsedSalary {
  min: number | null;
  max: number | null;
  currency: string | null;
  period: SalaryPeriod | null;
}

export function toHourlyUsd(
  amount: number,
  currency: string | null,
  period: SalaryPeriod | null,
): number | null {
  if (!period) return null;
  const rate = TO_USD[(currency ?? "USD").toUpperCase()];
  if (rate === undefined) return null;
  return (amount * rate) / HOURS_PER[period];
}

function parseAmount(raw: string): number {
  const cleaned = raw.replace(/[,\s]/g, "").toLowerCase();
  const m = /^(\d+(?:\.\d+)?)(k)?$/.exec(cleaned);
  if (!m) return NaN;
  const n = Number.parseFloat(m[1]!);
  return m[2] ? n * 1000 : n;
}

function detectPeriod(text: string): SalaryPeriod | null {
  const t = text.toLowerCase();
  if (/(per|\/|an|a)\s*(hour|hr)\b|hourly|\bp\/?h\b|\bph\b/.test(t)) return "hour";
  if (/(per|\/|a)\s*day\b|daily|\bpd\b/.test(t)) return "day";
  if (/(per|\/|a)\s*week\b|weekly/.test(t)) return "week";
  if (/(per|\/|a)\s*month\b|monthly|\bpm\b|\bmo\b/.test(t)) return "month";
  if (/(per|\/|a)\s*(year|yr|annum)\b|annual|yearly|\bpa\b/.test(t)) return "year";
  return null;
}

function detectCurrency(text: string): string | null {
  const code =
    /\b(USD|EUR|GBP|CAD|AUD|CHF|INR|PKR|SGD|AED|PLN|SEK|NOK|DKK|BRL|MXN|JPY|ZAR|NZD)\b/i.exec(text);
  if (code) return code[1]!.toUpperCase();
  for (const [sym, cur] of Object.entries(SYMBOLS)) if (text.includes(sym)) return cur;
  return null;
}

/**
 * Parse free-text salary like "$60k - $80k/year", "€45/hour", "40-60 USD per hour",
 * "PKR 250,000 per month". Infers the period from magnitude when it is not stated.
 */
export function parseSalaryText(text: string): ParsedSalary {
  const empty: ParsedSalary = { min: null, max: null, currency: null, period: null };
  if (!text) return empty;
  const nums = [...text.matchAll(/(\d[\d,]*(?:\.\d+)?\s*k?)(?![\d%])/gi)]
    .map((m) => parseAmount(m[1]!))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (nums.length === 0) return empty;
  const currency = detectCurrency(text);
  let period = detectPeriod(text);
  const [a, b] = nums;
  const min = a ?? null;
  const max = b ?? min;
  if (!period && min !== null) {
    if (min < 300) period = "hour";
    else if (min < 3000) period = "day";
    else if (min < 25_000) period = "month";
    else period = "year";
  }
  return { min, max, currency, period };
}

/** Returns the best-case (max) hourly USD figure, or null if nothing parseable. */
export function bestHourlyUsd(s: ParsedSalary): number | null {
  const amount = s.max ?? s.min;
  if (amount === null) return null;
  return toHourlyUsd(amount, s.currency, s.period);
}
