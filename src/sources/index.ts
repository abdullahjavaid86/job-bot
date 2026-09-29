import type { JobSource } from "./types.ts";
import type { BrowserSourceOptions } from "./indeed.ts";
import { arbeitnow } from "./arbeitnow.ts";
import { himalayas } from "./himalayas.ts";
import { indeedSource } from "./indeed.ts";
import { jobicy } from "./jobicy.ts";
import { linkedin } from "./linkedin.ts";
import { remoteok } from "./remoteok.ts";
import { remotive } from "./remotive.ts";
import { toptalSource } from "./toptal.ts";
import { weworkremotely } from "./weworkremotely.ts";
import { workingnomads } from "./workingnomads.ts";

const HTTP_SOURCES: JobSource[] = [
  remotive,
  remoteok,
  himalayas,
  arbeitnow,
  jobicy,
  weworkremotely,
  workingnomads,
  linkedin,
];

function allSources(opts: BrowserSourceOptions): JobSource[] {
  return [...HTTP_SOURCES, indeedSource(opts), toptalSource(opts)];
}

export function selectSources(
  names: string[] | undefined,
  opts: BrowserSourceOptions,
  includeBrowser: boolean,
): JobSource[] {
  const all = allSources(opts).filter((s) => includeBrowser || !s.needsBrowser);
  if (!names || names.length === 0) return all;
  const wanted = new Set(names.map((n) => n.toLowerCase()));
  const picked = all.filter((s) => wanted.has(s.name));
  const unknown = [...wanted].filter((n) => !all.some((s) => s.name === n));
  if (unknown.length)
    throw new Error(
      `Unknown source(s): ${unknown.join(", ")}. Known: ${all.map((s) => s.name).join(", ")}`,
    );
  return picked;
}
