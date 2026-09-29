import { describe, expect, it } from "vitest";
import { loadConfig, parseDotenv } from "../src/config.ts";

describe("parseDotenv", () => {
  it("strips inline comments from unquoted values", () => {
    expect(
      parseDotenv("JOBBOT_MODEL=qwen3:4b-instruct         # or an Ollama model such as llama3.1"),
    ).toEqual({
      JOBBOT_MODEL: "qwen3:4b-instruct",
    });
  });
  it("keeps # inside quotes and strips the quotes", () => {
    expect(parseDotenv(`A="x # not a comment"\nB='y'  # comment\nC="unterminated`)).toEqual({
      A: "x # not a comment",
      B: "y",
      C: "unterminated",
    });
  });
  it("ignores blank lines, comment lines, junk, and supports export", () => {
    expect(
      parseDotenv("\n# hello\nexport KEY=1\nnot a line\nURL=http://localhost:11434#frag\n"),
    ).toEqual({
      KEY: "1",
      URL: "http://localhost:11434#frag",
    });
  });
  it("later lines override earlier ones and empty values are allowed", () => {
    expect(parseDotenv("A=1\nA=2\nB=")).toEqual({ A: "2", B: "" });
  });
});

describe("loadConfig", () => {
  it("defaults the model per provider and rejects bad providers", () => {
    const save = { ...process.env };
    try {
      delete process.env.JOBBOT_MODEL;
      process.env.JOBBOT_PROVIDER = "ollama";
      expect(loadConfig()).toMatchObject({ provider: "ollama", model: "qwen3:4b-instruct" });
      process.env.JOBBOT_PROVIDER = "nope";
      expect(() => loadConfig()).toThrow(/Unknown provider/);
    } finally {
      process.env = save;
    }
  });
});
