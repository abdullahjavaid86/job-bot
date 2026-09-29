import type { LLM } from "../llm/types.ts";
import type { Job, Profile } from "../types.ts";

const SYSTEM = `Write a concise cover letter (150-220 words) in the candidate's first-person voice for the given job.
- Use only facts from the profile. Do not invent achievements, employers, or metrics.
- Open with the role and company, connect 2-3 of the candidate's strongest relevant experiences to the posting's needs, mention remote/contract availability, close with a short call to action.
- Plain text, no placeholders, no subject line, no markdown. Sign off with the candidate's full name.`;

export async function writeCoverLetter(
  llm: LLM,
  model: string,
  profile: Profile,
  job: Job,
): Promise<string> {
  return llm.text({
    model,
    system: SYSTEM,
    content: `PROFILE\n${JSON.stringify(profile, null, 2)}\n\nJOB\n${JSON.stringify({ title: job.title, company: job.company, location: job.location, employmentType: job.employmentType }, null, 2)}\n\nDESCRIPTION\n${job.description.slice(0, Math.min(6000, llm.maxInputChars))}`,
    effort: "low",
  });
}
