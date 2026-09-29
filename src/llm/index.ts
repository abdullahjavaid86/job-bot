import process from "node:process";
import type { Config } from "../config.ts";
import { AnthropicLLM } from "./anthropic.ts";
import { OllamaLLM } from "./ollama.ts";
import type { LLM } from "./types.ts";

export function createLLM(
  config: Pick<Config, "provider" | "ollamaHost" | "ollamaNumCtx" | "ollamaTimeoutMs">,
): LLM {
  switch (config.provider) {
    case "anthropic":
      return new AnthropicLLM();
    case "ollama":
      return new OllamaLLM({
        host: config.ollamaHost,
        numCtx: config.ollamaNumCtx,
        idleTimeoutMs: config.ollamaTimeoutMs,
        onProgress: ({ model, tokens }) => process.stderr.write(`\r  ${model}: ${tokens} tokens…`),
      });
  }
}
