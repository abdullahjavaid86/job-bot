import type { z } from "zod";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** Provider-neutral message content. */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "pdf"; bytes: Buffer; title: string };
export type Content = string | ContentPart[];

export interface StructuredRequest<T extends z.ZodType> {
  model: string;
  system: string;
  /** Identical across calls in one run (profile, rules); providers may cache it. */
  cachedContext?: string;
  content: Content;
  schema: T;
  effort?: Effort;
  maxTokens?: number;
}

export interface TextRequest {
  model: string;
  system: string;
  content: Content;
  effort?: Effort;
}

export interface LLM {
  readonly provider: string;
  /** True when PDF content parts can be sent as-is; otherwise callers must send extracted text. */
  readonly supportsDocuments: boolean;
  /** Callers trim long free text (job descriptions, page text) to this many characters. */
  readonly maxInputChars: number;
  /** How many requests may be in flight at once. */
  readonly concurrency: number;
  structured<T extends z.ZodType>(req: StructuredRequest<T>): Promise<z.infer<T>>;
  text(req: TextRequest): Promise<string>;
}

export class RefusalError extends Error {
  readonly category: string | null;

  constructor(category: string | null, explanation: string | null) {
    super(
      `Claude declined the request${category ? ` (${category})` : ""}${explanation ? `: ${explanation}` : ""}`,
    );
    this.category = category;
  }
}

export function contentToText(content: Content): string {
  if (typeof content === "string") return content;
  return content
    .map((p) =>
      p.type === "text" ? p.text : `[PDF document "${p.title}" omitted: provider cannot read PDFs]`,
    )
    .join("\n\n");
}
