import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { parseProvider } from "../src/config.ts";
import { createLLM } from "../src/llm/index.ts";
import { contentToText } from "../src/llm/types.ts";
import { OllamaLLM } from "../src/llm/ollama.ts";

const Schema = z.object({ score: z.number(), tags: z.array(z.string()) });

function fakeFetch(replies: Array<{ status?: number; body: unknown } | Error>) {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    const next = replies.shift();
    if (next instanceof Error) throw next;
    const status = next?.status ?? 200;
    if (status !== 200) return new Response(JSON.stringify(next?.body ?? {}), { status });
    const { message } = next!.body as { message: { role: string; content: string } };
    // stream the content as several NDJSON chunks, like Ollama does
    const parts = message.content.match(/.{1,7}/gs) ?? [""];
    const lines = parts.map((c) =>
      JSON.stringify({ message: { role: "assistant", content: c }, done: false }),
    );
    lines.push(JSON.stringify({ message: { role: "assistant", content: "" }, done: true }));
    return new Response(`${lines.join("\n")}\n`, { status: 200 });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

const llm = (f: typeof fetch) =>
  new OllamaLLM({ host: "http://ollama.test:11434/", numCtx: 4096, fetchImpl: f });

describe("OllamaLLM.structured", () => {
  it("sends system+cached context, JSON schema format, and parses the reply", async () => {
    const { fn, calls } = fakeFetch([
      { body: { message: { role: "assistant", content: '{"score": 88, "tags": ["react"]}' } } },
    ]);
    const out = await llm(fn).structured({
      model: "llama3.1",
      system: "SYS",
      cachedContext: "CTX",
      content: "hello",
      schema: Schema,
      maxTokens: 500,
    });
    expect(out).toEqual({ score: 88, tags: ["react"] });
    expect(calls[0]!.url).toBe("http://ollama.test:11434/api/chat");
    const body = calls[0]!.body;
    expect(body.model).toBe("llama3.1");
    expect(body.stream).toBe(true);
    expect(body.think).toBe(false);
    expect(body.messages).toEqual([
      { role: "system", content: "SYS\n\nCTX" },
      { role: "user", content: "hello" },
    ]);
    expect(body.format).toMatchObject({ type: "object", required: ["score", "tags"] });
    expect(body.options).toEqual({ temperature: 0, num_ctx: 4096, num_predict: 500 });
  });
  it("retries once on invalid JSON, then fails with a clear error", async () => {
    const { fn, calls } = fakeFetch([
      { body: { message: { role: "assistant", content: '{"score": 1, "tags": [' } } },
      { body: { message: { role: "assistant", content: '{"score": "high", "tags": []}' } } },
    ]);
    await expect(
      llm(fn).structured({ model: "m", system: "s", content: "c", schema: Schema }),
    ).rejects.toThrow(/did not return valid structured output/);
    expect(calls).toHaveLength(2);
  });
  it("recovers when the second attempt is valid", async () => {
    const { fn } = fakeFetch([
      { body: { message: { role: "assistant", content: "not json" } } },
      { body: { message: { role: "assistant", content: '{"score": 2, "tags": []}' } } },
    ]);
    expect(
      await llm(fn).structured({ model: "m", system: "s", content: "c", schema: Schema }),
    ).toEqual({ score: 2, tags: [] });
  });
  it("explains a missing model", async () => {
    const { fn } = fakeFetch([
      { status: 404, body: { error: 'model "llama9" not found, try pulling it first' } },
    ]);
    await expect(
      llm(fn).structured({ model: "llama9", system: "s", content: "c", schema: Schema }),
    ).rejects.toThrow(/ollama pull llama9/);
  });
  it("re-sends without `think` for models that reject it, and remembers", async () => {
    const { fn, calls } = fakeFetch([
      { status: 400, body: { error: '"nemotron-mini" does not support thinking' } },
      { body: { message: { role: "assistant", content: '{"score": 3, "tags": []}' } } },
      { body: { message: { role: "assistant", content: '{"score": 4, "tags": []}' } } },
    ]);
    const o = llm(fn);
    expect(await o.structured({ model: "m", system: "s", content: "c", schema: Schema })).toEqual({
      score: 3,
      tags: [],
    });
    expect(await o.structured({ model: "m", system: "s", content: "c", schema: Schema })).toEqual({
      score: 4,
      tags: [],
    });
    expect(calls.map((c) => "think" in c.body)).toEqual([true, false, false]);
  });
  it("reports an idle timeout as slowness, not as a dead server", async () => {
    const fn = (async (_url: string, init?: RequestInit) =>
      new Response(
        new ReadableStream({
          start(controller) {
            init?.signal?.addEventListener("abort", () =>
              controller.error(new DOMException("aborted", "AbortError")),
            );
          },
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
    const o = new OllamaLLM({
      host: "http://ollama.test:11434",
      numCtx: 1024,
      idleTimeoutMs: 50,
      fetchImpl: fn,
    });
    await expect(o.text({ model: "big", system: "s", content: "c" })).rejects.toThrow(
      /produced no output for 0 minutes.*big/,
    );
  });
  it("explains an unreachable server", async () => {
    const { fn } = fakeFetch([new TypeError("fetch failed")]);
    await expect(llm(fn).text({ model: "m", system: "s", content: "c" })).rejects.toThrow(
      /Cannot connect to Ollama at http:\/\/ollama.test:11434/,
    );
  });
});

describe("OllamaLLM.text", () => {
  it("returns trimmed content and flattens PDF parts to a notice", async () => {
    const { fn, calls } = fakeFetch([
      { body: { message: { role: "assistant", content: "  Dear team,\n" } } },
    ]);
    const out = await llm(fn).text({
      model: "m",
      system: "s",
      content: [
        { type: "text", text: "A" },
        { type: "pdf", bytes: Buffer.from("x"), title: "CV" },
      ],
    });
    expect(out).toBe("Dear team,");
    const user = (calls[0]!.body.messages as Array<{ content: string }>)[1]!.content;
    expect(user).toBe('A\n\n[PDF document "CV" omitted: provider cannot read PDFs]');
    expect(calls[0]!.body.format).toBeUndefined();
  });
});

describe("provider selection", () => {
  it("parses provider names and rejects unknown ones", () => {
    expect(parseProvider("ollama")).toBe("ollama");
    expect(() => parseProvider("openai")).toThrow(/Unknown provider/);
  });
  it("createLLM returns the right provider", () => {
    expect(
      createLLM({ provider: "ollama", ollamaHost: "http://x", ollamaNumCtx: 1, ollamaTimeoutMs: 1 })
        .provider,
    ).toBe("ollama");
    expect(
      createLLM({ provider: "ollama", ollamaHost: "http://x", ollamaNumCtx: 1, ollamaTimeoutMs: 1 })
        .supportsDocuments,
    ).toBe(false);
    expect(contentToText("plain")).toBe("plain");
  });
});
