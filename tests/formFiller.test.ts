import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  clickButton,
  executeActions,
  inventory,
  SUCCESS_RE,
  type FormPlan,
} from "../src/apply/formFiller.ts";

const HTML = `<!doctype html><html><body>
<h1>Apply for Senior React Developer</h1>
<form id="f">
  <label for="first">First name *</label><input id="first" name="first_name" required>
  <label for="email">Email</label><input id="email" type="email" name="email" placeholder="you@example.com">
  <label for="cl">Cover letter</label><textarea id="cl" name="cover_letter"></textarea>
  <label for="source">How did you hear about us?</label>
  <select id="source" name="source"><option value="">Select…</option><option value="li">LinkedIn</option><option value="jb">Job board</option></select>
  <fieldset><legend>Are you authorized to work in the US?</legend>
    <label><input type="radio" name="auth" value="yes"> Yes</label>
    <label><input type="radio" name="auth" value="no"> No</label>
  </fieldset>
  <label><input type="checkbox" name="privacy"> I agree to the privacy policy</label>
  <label for="cv">Resume/CV</label><input id="cv" type="file" name="resume">
  <input type="hidden" name="token" value="x">
  <button type="button" id="next" onclick="document.getElementById('done').hidden=false">Submit application</button>
  <a href="#">Sign in</a>
</form>
<p id="done" hidden>Thank you for applying! Your application has been received.</p>
</body></html>`;

let browser: Browser;
let page: Page;
let dir: string;

beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "jobbot-form-"));
  fs.writeFileSync(path.join(dir, "cv.pdf"), "%PDF-1.4 fake");
  await page.setContent(HTML);
});
afterAll(async () => {
  await browser.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("form filler against a real page", () => {
  it("inventories fields with labels, kinds, options, and advancing buttons", async () => {
    const inv = await inventory(page);
    const byLabel = Object.fromEntries(inv.fields.map((f) => [f.label, f]));
    expect(byLabel["First name *"]).toMatchObject({
      kind: "text",
      name: "first_name",
      required: true,
    });
    expect(byLabel["Email"]).toMatchObject({ kind: "text", placeholder: "you@example.com" });
    expect(byLabel["Cover letter"]).toMatchObject({ kind: "textarea" });
    expect(byLabel["How did you hear about us?"]).toMatchObject({
      kind: "select",
      options: ["Select…", "LinkedIn", "Job board"],
    });
    expect(byLabel["Are you authorized to work in the US?"]).toMatchObject({
      kind: "radio",
      options: ["Yes", "No"],
    });
    expect(byLabel["I agree to the privacy policy"]).toMatchObject({ kind: "checkbox" });
    expect(byLabel["Resume/CV"]).toMatchObject({ kind: "file" });
    expect(inv.fields.some((f) => f.name === "token")).toBe(false);
    expect(inv.buttons.map((b) => b.text)).toEqual(["Submit application", "Sign in"]);
    expect(inv.bodyText).toContain("Apply for Senior React Developer");
  });

  it("executes a plan: fills, selects, checks radios/boxes, uploads, then submits", async () => {
    const inv = await inventory(page);
    const id = (label: string) => inv.fields.find((f) => f.label === label)!.id;
    const plan: FormPlan = {
      pageState: "form",
      fieldActions: [
        { fieldId: id("First name *"), action: "fill", value: "Ada" },
        { fieldId: id("Email"), action: "fill", value: "ada@example.com" },
        { fieldId: id("Cover letter"), action: "fill", value: "Dear team," },
        { fieldId: id("How did you hear about us?"), action: "select", value: "Job board" },
        { fieldId: id("Are you authorized to work in the US?"), action: "select", value: "No" },
        { fieldId: id("I agree to the privacy policy"), action: "check", value: "" },
        { fieldId: id("Resume/CV"), action: "upload_cv", value: "" },
        { fieldId: "does-not-exist", action: "fill", value: "ignored" },
      ],
      nextButtonId: inv.buttons.find((b) => b.text === "Submit application")!.id,
      nextButtonIsFinalSubmit: true,
      unanswered: [],
      note: "",
    };
    const problems = await executeActions(page, plan, inv, {
      cvPath: path.join(dir, "cv.pdf"),
      coverLetterPath: null,
    });
    expect(problems).toEqual([]);
    expect(await page.inputValue("#first")).toBe("Ada");
    expect(await page.inputValue("#email")).toBe("ada@example.com");
    expect(await page.inputValue("#cl")).toBe("Dear team,");
    expect(await page.inputValue("#source")).toBe("jb");
    expect(await page.isChecked("input[name=auth][value=no]")).toBe(true);
    expect(await page.isChecked("input[name=privacy]")).toBe(true);
    expect(
      await page.evaluate(
        () => (document.getElementById("cv") as HTMLInputElement).files?.[0]?.name,
      ),
    ).toBe("cv.pdf");

    const after = await clickButton(page, plan.nextButtonId!);
    expect(after).toBe(page);
    expect(SUCCESS_RE.test(await page.innerText("body"))).toBe(true);
  });

  it("reports actions that cannot be executed instead of throwing", async () => {
    const inv = await inventory(page);
    const sel = inv.fields.find((f) => f.kind === "select")!;
    const problems = await executeActions(
      page,
      {
        pageState: "form",
        fieldActions: [{ fieldId: sel.id, action: "select", value: "Nonexistent option" }],
        nextButtonId: null,
        nextButtonIsFinalSubmit: false,
        unanswered: [],
        note: "",
      },
      inv,
      { cvPath: "x", coverLetterPath: null },
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/could not select "How did you hear about us\?"/);
  });
});

describe("SUCCESS_RE", () => {
  it("matches common confirmations and not job pages", () => {
    expect(SUCCESS_RE.test("Your application has been submitted")).toBe(true);
    expect(SUCCESS_RE.test("Thanks! We've received your application.")).toBe(true);
    expect(SUCCESS_RE.test("Apply now for this role. Applications close Friday.")).toBe(false);
  });
});
