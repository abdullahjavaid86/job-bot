import type { Criteria, Job, Profile } from "../types.ts";

import type { LLM } from "../llm/types.ts";
import type { Page } from "playwright";
import { log } from "../log.ts";
import { z } from "zod";

export interface FieldInfo {
  id: string;
  kind: "text" | "textarea" | "select" | "checkbox" | "radio" | "file" | "combobox";
  label: string;
  name: string;
  placeholder: string;
  required: boolean;
  value: string;
  options: string[];
}

export interface ButtonInfo {
  id: string;
  text: string;
}

export interface PageInventory {
  url: string;
  title: string;
  fields: FieldInfo[];
  buttons: ButtonInfo[];
  bodyText: string;
}

const ATTR = "data-jobbot-id";
const T = { timeout: 5_000 };

/** Tag every interactive element with a stable id and describe it. Runs inside the page. */
export async function inventory(page: Page): Promise<PageInventory> {
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- helpers must live inside the serialized page function
  return page.evaluate((attr) => {
    // oxlint-disable-next-line unicorn/consistent-function-scoping -- serialized into the page
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none";
    };
    // oxlint-disable-next-line unicorn/consistent-function-scoping -- serialized into the page
    const txt = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    const labelFor = (el: HTMLElement): string => {
      const id = el.getAttribute("id");
      if (id) {
        const l = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (l && txt(l)) return txt(l);
      }
      const aria = el.getAttribute("aria-label");
      if (aria) return aria.trim();
      const by = el.getAttribute("aria-labelledby");
      if (by) {
        const t = by
          .split(/\s+/)
          .map((i) => txt(document.getElementById(i)))
          .filter(Boolean)
          .join(" ");
        if (t) return t;
      }
      const wrap = el.closest("label");
      if (wrap && txt(wrap)) return txt(wrap).slice(0, 200);
      const group = el.closest("fieldset, [role=group], [role=radiogroup]");
      const legend = group?.querySelector("legend, [id]") ?? null;
      if (legend && txt(legend)) return txt(legend).slice(0, 200);
      let node: Element | null = el.parentElement;
      for (let depth = 0; node && depth < 4; depth++) {
        const prev = node.previousElementSibling;
        if (prev && txt(prev) && txt(prev).length < 200) return txt(prev);
        node = node.parentElement;
      }
      return "";
    };

    let counter = 0;
    const tag = (el: Element) => {
      let id = el.getAttribute(attr);
      if (!id) {
        id = `f${++counter}_${Math.random().toString(36).slice(2, 7)}`;
        el.setAttribute(attr, id);
      }
      return id;
    };

    const fields: FieldInfo[] = [];
    const seenRadioGroups = new Set<string>();
    const inputs = document.querySelectorAll<HTMLElement>(
      "input:not([type=hidden]):not([type=submit]):not([type=button]), textarea, select, [role=combobox], [contenteditable=true]",
    );
    for (const el of inputs) {
      if (!visible(el) && !(el instanceof HTMLInputElement && el.type === "file")) continue;
      if ((el as HTMLInputElement).disabled) continue;
      const tagName = el.tagName.toLowerCase();
      let kind: FieldInfo["kind"] = "text";
      let options: string[] = [];
      let value = "";
      if (el instanceof HTMLInputElement) {
        if (el.type === "file") kind = "file";
        else if (el.type === "checkbox") kind = "checkbox";
        else if (el.type === "radio") {
          kind = "radio";
          const key = el.name || labelFor(el);
          if (seenRadioGroups.has(key)) continue;
          seenRadioGroups.add(key);
          const group = el.name
            ? document.querySelectorAll<HTMLInputElement>(
                `input[type=radio][name="${CSS.escape(el.name)}"]`,
              )
            : [el];
          options = [...group].map((r) => labelFor(r) || r.value);
          for (const r of group) tag(r);
          const id = tag(el);
          fields.push({
            id,
            kind,
            label:
              txt(el.closest("fieldset")?.querySelector("legend") ?? null) ||
              labelFor((el.closest("fieldset") as HTMLElement) ?? el) ||
              el.name,
            name: el.name,
            placeholder: "",
            required: el.required,
            value: [...group].find((r) => r.checked)?.value ?? "",
            options,
          });
          continue;
        }
        value = el.type === "checkbox" ? String(el.checked) : el.value;
      } else if (el instanceof HTMLTextAreaElement) {
        kind = "textarea";
        value = el.value;
      } else if (el instanceof HTMLSelectElement) {
        kind = "select";
        options = [...el.options].map((o) => o.text.trim()).filter(Boolean);
        value = el.selectedOptions[0]?.text.trim() ?? "";
      } else if (
        tagName !== "input" &&
        (el.getAttribute("role") === "combobox" || el.isContentEditable)
      ) {
        kind = el.isContentEditable ? "textarea" : "combobox";
        value = txt(el);
      }
      fields.push({
        id: tag(el),
        kind,
        label: labelFor(el),
        name: el.getAttribute("name") ?? "",
        placeholder: el.getAttribute("placeholder") ?? "",
        required: el.hasAttribute("required") || el.getAttribute("aria-required") === "true",
        value,
        options,
      });
    }

    const buttons: ButtonInfo[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(
      "button, [role=button], input[type=submit], a[href]",
    )) {
      if (!visible(el)) continue;
      const text =
        (el instanceof HTMLInputElement ? el.value : txt(el)) ||
        el.getAttribute("aria-label") ||
        "";
      if (!text || text.length > 60) continue;
      if (
        !/apply|submit|next|continue|review|send|save|proceed|start|finish|done|upload|attach|i agree|accept|easy apply|sign in|log in/i.test(
          text,
        )
      )
        continue;
      buttons.push({ id: tag(el), text: text.slice(0, 60) });
    }

    return {
      url: location.href,
      title: document.title,
      fields,
      buttons,
      bodyText: (document.body?.innerText ?? "").replace(/\s+/g, " ").slice(0, 4000),
    };
  }, ATTR);
}

const FieldAction = z.object({
  fieldId: z.string(),
  action: z.enum([
    "fill",
    "select",
    "check",
    "uncheck",
    "upload_cv",
    "upload_cover_letter",
    "skip",
  ]),
  value: z
    .string()
    .describe("Text to type or exact option label to select; empty for check/upload/skip"),
});

const FormPlan = z.object({
  pageState: z.enum([
    "form",
    "login_required",
    "already_applied",
    "submitted",
    "external_apply_link",
    "not_applicable",
    "blocked",
  ]),
  fieldActions: z.array(FieldAction),
  nextButtonId: z.string().nullable().describe("Button to click after filling; null if none"),
  nextButtonIsFinalSubmit: z.boolean(),
  unanswered: z
    .array(z.string())
    .describe("Labels of required fields you could not answer truthfully"),
  note: z.string(),
});
export type FormPlan = z.infer<typeof FormPlan>;

const SYSTEM = `You operate a job-application web form on behalf of a candidate. You see an inventory of the visible form fields and buttons plus the page text, and you return a plan.

Truthfulness is absolute: fill fields only with facts from the profile. Never claim work authorization, citizenship, degrees, clearances, or experience the profile does not show. If a required question cannot be answered truthfully or the answer is unknown, leave it and list it in "unanswered".

Field guidance:
- Name/email/phone/location/links: from the profile. Phone in international format.
- Resume/CV file input: action "upload_cv". Cover letter file input: "upload_cover_letter"; cover letter textarea: fill with the provided cover letter text.
- Salary / rate expectations: quote at or slightly above criteria.minHourlyUsd per hour (or the annual equivalent ×2080) unless the posting states a range that is higher, then use its lower bound. Say "negotiable" only in free-text fields that ask for a sentence.
- "How did you hear about us": pick the option matching the job source (LinkedIn, Indeed, job board, other).
- Work authorization / relocation / sponsorship: answer truthfully for a candidate living in criteria.candidateCountry who works remotely. Do not tick consent boxes for background checks or terms unless required to proceed; do tick "I agree to the privacy policy" style boxes when required.
- Voluntary self-identification (gender, race, veteran, disability): choose "decline to self-identify" / "prefer not to say" options.
- Free-text questions ("why us", "describe experience with X"): 2-4 sentences grounded in the profile and the job description.
- Pre-filled fields with a correct value: "skip".
- For selects/radios/comboboxes use the exact option label.

Buttons: pick the button that advances the application (Apply, Easy Apply, Next, Continue, Review, Submit application). Set nextButtonIsFinalSubmit=true only for the button that sends the application. Never pick sign-in buttons; if a login is needed set pageState=login_required.

pageState: "form" when there are fields or an advancing button; "login_required" when the page asks to sign in; "already_applied" if the page says so; "submitted" if a success/thank-you message is shown; "external_apply_link" when the only way forward is an Apply link to another site (choose it as nextButtonId); "blocked" for CAPTCHAs or bot checks; "not_applicable" when the page is not an application at all (e.g. Toptal network sign-up, expired posting).`;

export interface PlanContext {
  profile: Profile;
  criteria: Criteria;
  job: Job;
  coverLetter: string;
  step: number;
  history: string[];
}

export async function planStep(
  llm: LLM,
  model: string,
  inv: PageInventory,
  ctx: PlanContext,
): Promise<FormPlan> {
  return llm.structured({
    model,
    system: SYSTEM,
    cachedContext: `CANDIDATE PROFILE\n${JSON.stringify(ctx.profile, null, 2)}\n\nCRITERIA\n${JSON.stringify(ctx.criteria, null, 2)}`,
    content: [
      `JOB: ${ctx.job.title} at ${ctx.job.company} (source: ${ctx.job.source})`,
      `Job description (excerpt):\n${ctx.job.description.slice(0, Math.min(3000, llm.maxInputChars / 2))}`,
      `\nCOVER LETTER TEXT:\n${ctx.coverLetter}`,
      `\nSTEP ${ctx.step}. Previous steps: ${ctx.history.length ? ctx.history.join(" | ") : "none"}`,
      `\nPAGE URL: ${inv.url}\nPAGE TITLE: ${inv.title}`,
      `\nFIELDS:\n${JSON.stringify(inv.fields, null, 1)}`,
      `\nBUTTONS:\n${JSON.stringify(inv.buttons)}`,
      `\nPAGE TEXT:\n${inv.bodyText.slice(0, Math.min(4000, llm.maxInputChars / 2))}`,
    ].join("\n"),
    schema: FormPlan,
    effort: "medium",
    maxTokens: 8_000,
  });
}

export interface ExecuteOptions {
  cvPath: string;
  coverLetterPath: string | null;
}

export async function executeActions(
  page: Page,
  plan: FormPlan,
  inv: PageInventory,
  opts: ExecuteOptions,
): Promise<string[]> {
  const notes: string[] = [];
  const byId = new Map(inv.fields.map((f) => [f.id, f]));
  for (const a of plan.fieldActions) {
    const field = byId.get(a.fieldId);
    if (!field || a.action === "skip") continue;
    const loc = page.locator(`[${ATTR}="${a.fieldId}"]`).first();
    try {
      const findAndClick = async () => {
        const opt = page
          .locator(`[role=option]:has-text("${a.value.replace(/"/g, '\\"')}")`)
          .first();
        if (await opt.isVisible().catch(() => false)) await opt.click();
        else await loc.press("Enter").catch(() => null);
      };
      switch (a.action) {
        case "fill":
          if (field.kind === "combobox") {
            await loc.click(T);
            await loc.fill(a.value, T).catch(() => loc.pressSequentially(a.value, T));
            await page.waitForTimeout(600);
            findAndClick();
          } else if (
            field.kind === "textarea" &&
            !(await loc.evaluate((e) => e instanceof HTMLTextAreaElement))
          ) {
            await loc.click(T);
            await loc.fill(a.value, T).catch(() => loc.pressSequentially(a.value, T));
          } else {
            await loc.fill(a.value, T);
          }
          break;
        case "select":
          if (field.kind === "select") {
            await loc.selectOption({ label: a.value }, T).catch(() => loc.selectOption(a.value, T));
          } else if (field.kind === "radio") {
            const idx = field.options.findIndex((o) => o.toLowerCase() === a.value.toLowerCase());
            const radios = field.name
              ? page.locator(`input[type=radio][name="${field.name.replace(/"/g, '\\"')}"]`)
              : loc;
            if (idx >= 0) await radios.nth(idx).check({ force: true, ...T });
            else await radios.first().check({ force: true, ...T });
          } else {
            await loc.click(T);
            await loc.fill(a.value, T).catch(() => null);
            await page.waitForTimeout(500);
            findAndClick();
          }
          break;
        case "check":
          await loc.check({ force: true, ...T });
          break;
        case "uncheck":
          await loc.uncheck({ force: true, ...T });
          break;
        case "upload_cv":
          await loc.setInputFiles(opts.cvPath, T);
          await page.waitForTimeout(1500);
          break;
        case "upload_cover_letter":
          if (opts.coverLetterPath) {
            await loc.setInputFiles(opts.coverLetterPath, T);
            await page.waitForTimeout(1000);
          }
          break;
      }
    } catch (err) {
      const msg = `could not ${a.action} "${field.label || field.name || a.fieldId}": ${(err as Error).message.split("\n")[0]}`;
      notes.push(msg);
      log.warn(msg);
    }
  }
  return notes;
}

export async function clickButton(page: Page, buttonId: string): Promise<Page> {
  const loc = page.locator(`[${ATTR}="${buttonId}"]`).first();
  const popupPromise = page
    .context()
    .waitForEvent("page", { timeout: 4000 })
    .catch(() => null);
  await loc.click({ timeout: 10_000 });
  const popup = await popupPromise;
  if (popup) {
    await popup.waitForLoadState("domcontentloaded").catch(() => null);
    return popup;
  }
  await page.waitForLoadState("domcontentloaded").catch(() => null);
  await page.waitForTimeout(1500);
  return page;
}

export const SUCCESS_RE =
  /application (was )?(submitted|received|sent|complete)|thank you for (applying|your application|your interest)|we('ve| have) received your application|successfully (applied|submitted)|your application has been/i;
