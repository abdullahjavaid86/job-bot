import { z } from "zod";
import { contentToText, type LLM, type StructuredRequest, type TextRequest } from "./types.ts";

export interface OllamaOptions {
  host: string;
  /** Context window to request; small models default to 2-4k which is too little for a job description. */
  numCtx: number;
  /** Abort if no bytes arrive from Ollama for this long (model load + prompt processing + generation gaps). */
  idleTimeoutMs?: number;
  fetchImpl?: typeof fetch;
  onProgress?: (info: { model: string; tokens: number }) => void;
}

interface ChatChunk {
  message?: { role: string; content: string; thinking?: string };
  error?: string;
  done?: boolean;
}

const DEFAULT_IDLE_TIMEOUT_MS = 20 * 60_000;

/**
 * Local models through Ollama's /api/chat.
 *
 * - Responses are streamed (NDJSON) so headers arrive at once; a non-streamed call on a CPU-only
 *   machine can take longer than Node's 5-minute header timeout and looks like a dead server.
 * - Structured output uses Ollama's `format` parameter with the Zod schema converted to JSON
 *   Schema; the reply is validated with Zod and retried once, because small models
 *   occasionally return incomplete JSON.
 * - Thinking is disabled (`think: false`) because reasoning tokens multiply latency on CPU;
 *   models that do not support the flag get the request re-sent without it.
 */
export class OllamaLLM implements LLM {
  readonly provider = "ollama";
  readonly supportsDocuments = false;
  /** Local models are slow per token; callers trim long inputs to this many characters. */
  readonly maxInputChars = 6_000;
  /** Ollama serves one request at a time by default; parallel calls only queue and time out. */
  readonly concurrency = 1;
  private readonly host: string;
  private readonly numCtx: number;
  private readonly idleTimeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly onProgress: OllamaOptions["onProgress"];
  private thinkSupported: boolean | null = null;

  constructor(opts: OllamaOptions) {
    this.host = opts.host.replace(/\/$/, "");
    this.numCtx = opts.numCtx;
    this.idleTimeoutMs = opts.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.onProgress = opts.onProgress;
  }

  private async chat(body: Record<string, unknown>): Promise<string> {
    const withThink = this.thinkSupported !== false;
    const payload = { ...body, stream: true, ...(withThink ? { think: false } : {}) };
    const controller = new AbortController();
    let timer = setTimeout(() => controller.abort(), this.idleTimeoutMs);
    const touch = () => {
      clearTimeout(timer);
      timer = setTimeout(() => controller.abort(), this.idleTimeoutMs);
    };
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.host}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      throw new Error(
        `Cannot connect to Ollama at ${this.host} (${(err as Error).message}). Start it with \`ollama serve\` or set OLLAMA_HOST.`,
        { cause: err },
      );
    }
    if (!res.ok) {
      clearTimeout(timer);
      const text = await res.text().catch(() => "");
      let message = text;
      try {
        message = (JSON.parse(text) as { error?: string }).error ?? text;
      } catch {
        // plain-text error body
      }
      if (withThink && /think/i.test(message) && /not support/i.test(message)) {
        this.thinkSupported = false;
        return this.chat(body);
      }
      const hint = /not found/i.test(message)
        ? ` Pull it with \`ollama pull ${String(body.model)}\`.`
        : "";
      throw new Error(`Ollama error ${res.status}: ${message}.${hint}`);
    }
    if (withThink) this.thinkSupported = true;

    let content = "";
    let tokens = 0;
    let buffer = "";
    const handleLine = (line: string) => {
      if (!line.trim()) return;
      const chunk = JSON.parse(line) as ChatChunk;
      if (chunk.error) throw new Error(`Ollama error: ${chunk.error}`);
      if (chunk.message?.content) {
        content += chunk.message.content;
        tokens++;
        if (tokens % 25 === 0) this.onProgress?.({ model: String(body.model), tokens });
      }
    };
    try {
      if (!res.body) throw new Error("Ollama returned an empty response body");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        touch();
        buffer += decoder.decode(value, { stream: true });
        let nl = buffer.indexOf("\n");
        while (nl >= 0) {
          handleLine(buffer.slice(0, nl));
          buffer = buffer.slice(nl + 1);
          nl = buffer.indexOf("\n");
        }
      }
      handleLine(buffer);
    } catch (err) {
      if (controller.signal.aborted) {
        throw new Error(
          `Ollama produced no output for ${Math.round(this.idleTimeoutMs / 60_000)} minutes (model ${String(body.model)}). The model is too slow for this machine; try a smaller one or raise OLLAMA_TIMEOUT_MS.`,
          { cause: err },
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
    return content;
  }

  private messages(system: string, cachedContext: string | undefined, content: string) {
    return [
      { role: "system", content: cachedContext ? `${system}\n\n${cachedContext}` : system },
      { role: "user", content },
    ];
  }

  async structured<T extends z.ZodType>(req: StructuredRequest<T>): Promise<z.infer<T>> {
    const format = z.toJSONSchema(req.schema, { target: "draft-7", io: "output" });
    const body = {
      model: req.model,
      messages: this.messages(req.system, req.cachedContext, contentToText(req.content)),
      format,
      options: {
        temperature: 0,
        num_ctx: this.numCtx,
        ...(req.maxTokens ? { num_predict: req.maxTokens } : {}),
      },
    };
    let lastError = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const raw = await this.chat(body);
      try {
        return req.schema.parse(JSON.parse(raw)) as z.infer<T>;
      } catch (err) {
        lastError = (err as Error).message.split("\n")[0] ?? "invalid output";
      }
    }
    throw new Error(
      `Ollama model ${req.model} did not return valid structured output: ${lastError}`,
    );
  }

  async text(req: TextRequest): Promise<string> {
    const raw = await this.chat({
      model: req.model,
      messages: this.messages(req.system, undefined, contentToText(req.content)),
      options: { num_ctx: this.numCtx },
    });
    return raw.trim();
  }
}
