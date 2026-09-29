import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PDFParse } from "pdf-parse";
import { z } from "zod";
import { CV_CANDIDATES } from "../config.ts";
import type { ContentPart, LLM } from "../llm/types.ts";
import { Criteria, DEFAULT_CRITERIA, Profile } from "../types.ts";

export function findCv(cwd: string): string | null {
  for (const name of CV_CANDIDATES) {
    const p = path.join(cwd, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export function readInstructions(file: string): string {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim() : "";
}

export function inputsHash(cvBytes: Buffer, instructions: string): string {
  return crypto
    .createHash("sha256")
    .update(cvBytes)
    .update("\n--\n")
    .update(instructions)
    .digest("hex");
}

async function pdfToText(bytes: Buffer): Promise<string> {
  const parser = new PDFParse({ data: bytes });
  try {
    return (await parser.getText()).text.trim();
  } finally {
    await parser.destroy();
  }
}

const Extraction = z.object({ profile: Profile, criteria: Criteria });

const SYSTEM = `You extract a structured candidate profile from a CV and a set of job-search criteria from the candidate's free-text instructions.

Rules:
- Use only facts present in the CV. Never invent employers, dates, degrees, or contact details. Use an empty string for anything missing.
- searchKeywords: 6-12 short job-board queries a recruiter would type for this person (e.g. "react developer", "full stack engineer", "node.js"). Base them on the CV's strongest, most recent skills and titles.
- targetRoles: job titles this candidate should realistically apply for.
- Criteria come from the instructions. Where the instructions are silent, keep the provided defaults exactly. Interpret money as USD unless another currency is stated; convert "per month"/"per year" figures to an hourly floor (÷173 / ÷2080).
- employmentTypes vocabulary: full_time, part_time, contract, freelance, internship. workModes vocabulary: remote, hybrid, onsite.
- If the instructions name a country the candidate lives in, set candidateCountry; otherwise use the CV's country; otherwise keep the default.
- extraInstructions: a faithful one-paragraph summary of any other preferences (industries, exclusions, companies to avoid, tone), or empty.`;

export interface ExtractInput {
  cvBytes: Buffer;
  cvFilename: string;
  instructions: string;
  model: string;
}

export async function extractProfile(
  llm: LLM,
  input: ExtractInput,
): Promise<{ profile: Profile; criteria: Criteria }> {
  const isPdf = input.cvFilename.toLowerCase().endsWith(".pdf");
  const cvBlock: ContentPart =
    isPdf && llm.supportsDocuments
      ? { type: "pdf", bytes: input.cvBytes, title: "CV" }
      : {
          type: "text",
          text: `CV (plain text):\n${isPdf ? await pdfToText(input.cvBytes) : input.cvBytes.toString("utf8")}`,
        };

  const content: ContentPart[] = [
    cvBlock,
    {
      type: "text",
      text: [
        `Candidate instructions (instructions.txt):\n${input.instructions || "(none provided)"}`,
        "",
        `Criteria defaults (keep any field the instructions do not change):\n${JSON.stringify(DEFAULT_CRITERIA, null, 2)}`,
        "",
        "Extract the profile and criteria.",
      ].join("\n"),
    },
  ];
  return llm.structured({
    model: input.model,
    system: SYSTEM,
    content,
    schema: Extraction,
    effort: "medium",
  });
}
