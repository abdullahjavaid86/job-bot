import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";

let shared: BrowserContext | null = null;

/**
 * One persistent Chromium profile for the whole bot so logins (LinkedIn, Indeed, ATS
 * accounts) survive between runs. The user logs in once in the visible window.
 */
async function getBrowser(dataDir: string, headless: boolean): Promise<BrowserContext> {
  if (shared) return shared;
  shared = await chromium.launchPersistentContext(path.join(dataDir, "browser-profile"), {
    headless,
    viewport: { width: 1280, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"],
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
  });
  return shared;
}

export async function newPage(dataDir: string, headless: boolean): Promise<Page> {
  const ctx = await getBrowser(dataDir, headless);
  return ctx.newPage();
}

export async function closeBrowser(): Promise<void> {
  if (shared) {
    await shared.close();
    shared = null;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
