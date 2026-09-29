import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import {
  RefusalError,
  type Content,
  type LLM,
  type StructuredRequest,
  type TextRequest,
} from "./types.ts";

function toBlocks(content: Content): Anthropic.MessageParam["content"] {
  if (typeof content === "string") return content;
  return content.map((p): Anthropic.ContentBlockParam =>
    p.type === "text"
      ? { type: "text", text: p.text }
      : {
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: p.bytes.toString("base64"),
          },
          title: p.title,
        },
  );
}

export class AnthropicLLM implements LLM {
  readonly provider = "anthropic";
  readonly supportsDocuments = true;
  readonly maxInputChars = 60_000;
  readonly concurrency = 4;
  readonly client: Anthropic;

  constructor(client: Anthropic = new Anthropic()) {
    this.client = client;
  }

  async structured<T extends z.ZodType>(req: StructuredRequest<T>): Promise<z.infer<T>> {
    const system: Anthropic.TextBlockParam[] = [{ type: "text", text: req.system }];
    if (req.cachedContext)
      system.push({ type: "text", text: req.cachedContext, cache_control: { type: "ephemeral" } });
    const response = await this.client.messages.parse({
      model: req.model,
      max_tokens: req.maxTokens ?? 16_000,
      system,
      messages: [{ role: "user", content: toBlocks(req.content) }],
      output_config: { effort: req.effort ?? "medium", format: zodOutputFormat(req.schema) },
    });
    if (response.stop_reason === "refusal") {
      throw new RefusalError(
        response.stop_details?.category ?? null,
        response.stop_details?.explanation ?? null,
      );
    }
    if (response.parsed_output === null || response.parsed_output === undefined) {
      throw new Error(`Claude returned no parseable output (stop_reason=${response.stop_reason})`);
    }
    return response.parsed_output as z.infer<T>;
  }

  async text(req: TextRequest): Promise<string> {
    const response = await this.client.messages.create({
      model: req.model,
      max_tokens: 16_000,
      system: req.system,
      messages: [{ role: "user", content: toBlocks(req.content) }],
      output_config: { effort: req.effort ?? "medium" },
    });
    if (response.stop_reason === "refusal") {
      throw new RefusalError(
        response.stop_details?.category ?? null,
        response.stop_details?.explanation ?? null,
      );
    }
    return response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
  }
}
