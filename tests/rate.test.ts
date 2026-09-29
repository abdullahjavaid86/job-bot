import { describe, expect, it } from "vitest";
import { bestHourlyUsd, parseSalaryText, toHourlyUsd } from "../src/filter/rate.ts";

describe("parseSalaryText", () => {
  it("parses hourly ranges", () => {
    expect(parseSalaryText("$40 - $60 per hour")).toEqual({
      min: 40,
      max: 60,
      currency: "USD",
      period: "hour",
    });
    expect(parseSalaryText("€45/hour")).toEqual({
      min: 45,
      max: 45,
      currency: "EUR",
      period: "hour",
    });
    expect(parseSalaryText("30-50 USD/hr")).toEqual({
      min: 30,
      max: 50,
      currency: "USD",
      period: "hour",
    });
  });
  it("parses annual with k suffix", () => {
    expect(parseSalaryText("$60k - $80k/year")).toEqual({
      min: 60_000,
      max: 80_000,
      currency: "USD",
      period: "year",
    });
    expect(parseSalaryText("£70,000 per annum")).toEqual({
      min: 70_000,
      max: 70_000,
      currency: "GBP",
      period: "year",
    });
  });
  it("parses monthly in other currencies", () => {
    expect(parseSalaryText("PKR 250,000 per month")).toEqual({
      min: 250_000,
      max: 250_000,
      currency: "PKR",
      period: "month",
    });
  });
  it("infers period from magnitude when not stated", () => {
    expect(parseSalaryText("$50").period).toBe("hour");
    expect(parseSalaryText("$5,000").period).toBe("month");
    expect(parseSalaryText("$120,000").period).toBe("year");
  });
  it("returns nulls for empty or textless input", () => {
    expect(parseSalaryText("")).toEqual({ min: null, max: null, currency: null, period: null });
    expect(parseSalaryText("Competitive")).toEqual({
      min: null,
      max: null,
      currency: null,
      period: null,
    });
  });
  it("ignores percentages", () => {
    expect(parseSalaryText("$100k plus 10% bonus").max).toBe(100_000);
  });
});

describe("toHourlyUsd / bestHourlyUsd", () => {
  it("converts annual USD", () => expect(toHourlyUsd(104_000, "USD", "year")).toBeCloseTo(50));
  it("converts monthly EUR", () => expect(toHourlyUsd(1730, "EUR", "month")).toBeCloseTo(10.8, 1));
  it("returns null with unknown period or currency", () => {
    expect(toHourlyUsd(10, "USD", null)).toBeNull();
    expect(toHourlyUsd(10, "XYZ", "hour")).toBeNull();
  });
  it("uses the max figure", () => {
    expect(bestHourlyUsd({ min: 20, max: 40, currency: "USD", period: "hour" })).toBe(40);
    expect(bestHourlyUsd({ min: null, max: null, currency: null, period: null })).toBeNull();
  });
});
