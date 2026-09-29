import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { mapArbeitnow, type ArbeitnowJob } from "../src/sources/arbeitnow.ts";
import {
  htmlToText,
  keywordMatches,
  normalizeEmployment,
  normalizeWorkMode,
} from "../src/sources/common.ts";
import { mapHimalayas, type HimalayasJob } from "../src/sources/himalayas.ts";
import { mapIndeed } from "../src/sources/indeed.ts";
import { mapJobicy, type JobicyJob } from "../src/sources/jobicy.ts";
import {
  parseApplicants,
  parseLinkedInCards,
  parseLinkedInDetail,
  toJob,
} from "../src/sources/linkedin.ts";
import { mapRemoteOk, type RemoteOkJob } from "../src/sources/remoteok.ts";
import { mapRemotive, type RemotiveJob } from "../src/sources/remotive.ts";
import { mapToptal } from "../src/sources/toptal.ts";
import { mapWwr, parseWwrRss } from "../src/sources/weworkremotely.ts";
import { mapNomads, type NomadsJob } from "../src/sources/workingnomads.ts";
import { Job } from "../src/types.ts";

const fixture = (name: string) =>
  fs.readFileSync(path.join(import.meta.dirname, "fixtures", name), "utf8");
const json = <T>(name: string) => JSON.parse(fixture(name)) as T;

describe("common helpers", () => {
  it("converts html to text with breaks and entities", () => {
    expect(
      htmlToText(
        "<p>Hello&nbsp;<b>world</b></p><ul><li>a</li><li>b &amp; c</li></ul><script>x()</script>",
      ),
    ).toBe("Hello world\n• a\n• b & c");
  });
  it("normalizes employment and work mode", () => {
    expect(normalizeEmployment("Full-Time")).toBe("full_time");
    expect(normalizeEmployment(["Contract", "Remote"])).toBe("contract");
    expect(normalizeEmployment("Freelance")).toBe("freelance");
    expect(normalizeEmployment("")).toBe("unknown");
    expect(normalizeWorkMode("Hybrid - Berlin")).toBe("hybrid");
    expect(normalizeWorkMode("On-site")).toBe("onsite");
    expect(normalizeWorkMode("Karachi", "remote")).toBe("remote");
  });
  it("keyword matching requires all words of one keyword", () => {
    expect(keywordMatches("Senior React Native Developer", ["react native"])).toBe(true);
    expect(keywordMatches("Senior React Developer", ["react native", "vue"])).toBe(false);
    expect(keywordMatches("anything", [])).toBe(true);
  });
});

describe("source mappers produce valid Job objects", () => {
  it("remotive", () => {
    const jobs = json<{ jobs: RemotiveJob[] }>("remotive.json").jobs.map(mapRemotive);
    for (const j of jobs) Job.parse(j);
    expect(jobs[0]!.id).toMatch(/^remotive:\d+$/);
    expect(jobs[0]!.workMode).toBe("remote");
    expect(jobs[0]!.description).not.toMatch(/<[a-z]+>/);
  });
  it("remoteok", () => {
    const raw = json<RemoteOkJob[]>("remoteok.json").filter((d) => typeof d.id === "string");
    const jobs = raw.map(mapRemoteOk);
    for (const j of jobs) Job.parse(j);
    expect(jobs[0]!.salaryPeriod === null || jobs[0]!.salaryPeriod === "year").toBe(true);
  });
  it("himalayas", () => {
    const jobs = json<{ jobs: HimalayasJob[] }>("himalayas.json").jobs.map(mapHimalayas);
    for (const j of jobs) Job.parse(j);
    expect(jobs[0]!.location).toBe("Worldwide");
  });
  it("arbeitnow", () => {
    const jobs = json<{ data: ArbeitnowJob[] }>("arbeitnow.json").data.map(mapArbeitnow);
    for (const j of jobs) Job.parse(j);
  });
  it("jobicy", () => {
    const jobs = json<{ jobs: JobicyJob[] }>("jobicy.json").jobs.map(mapJobicy);
    for (const j of jobs) Job.parse(j);
    expect(jobs[0]!.employmentType).toBe("full_time");
  });
  it("workingnomads", () => {
    const jobs = json<NomadsJob[]>("workingnomads.json").map(mapNomads);
    for (const j of jobs) Job.parse(j);
    expect(jobs[0]!.id).toBe("workingnomads:1891955");
    expect(jobs[0]!.title).toBe("Account Manager");
  });
  it("weworkremotely rss", () => {
    const items = parseWwrRss(fixture("weworkremotely.rss"));
    expect(items).toHaveLength(3);
    const jobs = items.map(mapWwr);
    for (const j of jobs) Job.parse(j);
    expect(jobs[0]).toMatchObject({
      company: "BBE Marketing Inc",
      title: "Senior Graphic Designer",
      employmentType: "full_time",
    });
    expect(parseWwrRss("<rss><channel></channel></rss>")).toEqual([]);
  });
  it("indeed and toptal", () => {
    Job.parse(
      mapIndeed(
        { jk: "abc", title: "Dev", company: "X", location: "Remote", salary: "$40 - $50 an hour" },
        "Contract role",
      ),
    );
    const t = mapToptal(
      {
        url: "https://www.toptal.com/freelance-jobs/developers/jobs/some-slug",
        title: "Rails Dev",
        snippet: "s",
      },
      "",
    );
    Job.parse(t);
    expect(t.id).toBe("toptal:some-slug");
    expect(t.employmentType).toBe("freelance");
  });
});

describe("linkedin parsers", () => {
  it("parses search cards", () => {
    const cards = parseLinkedInCards(fixture("linkedin-search.html"));
    expect(cards).toHaveLength(10);
    expect(cards[0]).toEqual({
      id: "4443945884",
      title: "React / TypeScript Developer:in (m/w/d)",
      company: "1st Log AG",
      location: "Hamburg, Hamburg, Germany",
      url: "https://de.linkedin.com/jobs/view/react-typescript-developer-in-m-w-d-at-1st-log-ag-4443945884",
      postedAt: "2026-07-22T00:00:00.000Z",
    });
    expect(parseLinkedInCards("<html></html>")).toEqual([]);
  });
  it("parses the detail page", () => {
    const d = parseLinkedInDetail(fixture("linkedin-detail.html"));
    expect(d.applicants).toBe(200);
    expect(d.employmentType).toBe("full_time");
    expect(d.criteria).toContain("Full-time");
    expect(d.description.length).toBeGreaterThan(200);
    expect(d.description).not.toMatch(/<[a-z]+>/);
  });
  it("parses applicant captions", () => {
    expect(parseApplicants("Over 200 applicants")).toBe(200);
    expect(parseApplicants("Be among the first 25 applicants")).toBe(24);
    expect(parseApplicants("37 applicants")).toBe(37);
    expect(parseApplicants("1,204 applicants")).toBe(1204);
    expect(parseApplicants("")).toBeNull();
  });
  it("combines card and detail into a Job", () => {
    const [card] = parseLinkedInCards(fixture("linkedin-search.html"));
    const j = toJob(card!, parseLinkedInDetail(fixture("linkedin-detail.html")), "remote");
    Job.parse(j);
    expect(j).toMatchObject({
      id: "linkedin:4443945884",
      applicants: 200,
      workMode: "remote",
      applyUrl: card!.url,
    });
  });
});

describe("toptal link classification", () => {
  it("recognises job and skill urls", async () => {
    const { TOPTAL_JOB_RE, TOPTAL_SKILL_RE, pickSkillPages } =
      await import("../src/sources/toptal.ts");
    expect(
      TOPTAL_JOB_RE.test(
        "https://www.toptal.com/freelance-jobs/developers/react-native/remote-react-native-developer-job-for-startup-full-time-172",
      ),
    ).toBe(true);
    expect(TOPTAL_JOB_RE.test("https://www.toptal.com/freelance-jobs/developers/react")).toBe(
      false,
    );
    expect(TOPTAL_SKILL_RE.test("https://www.toptal.com/freelance-jobs/developers/react")).toBe(
      true,
    );
    expect(
      TOPTAL_SKILL_RE.test("https://www.toptal.com/freelance-jobs/developers/jobs#apply"),
    ).toBe(false);
    const links = [
      { url: "https://www.toptal.com/freelance-jobs/developers/jobs", text: "Jobs" },
      { url: "https://www.toptal.com/freelance-jobs/developers/react", text: "React.js" },
      { url: "https://www.toptal.com/freelance-jobs/developers/python", text: "Python" },
      { url: "https://www.toptal.com/freelance-jobs/developers/java", text: "Java Developer Jobs" },
    ];
    expect(pickSkillPages(links, ["react developer", "python"])).toEqual([
      "https://www.toptal.com/freelance-jobs/developers/react",
      "https://www.toptal.com/freelance-jobs/developers/python",
    ]);
    expect(pickSkillPages(links, ["developer"])).toEqual([]);
  });
});
