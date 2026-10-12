import { describe, expect, it } from "vitest";
import {
  compareMavenVersions,
  intersectMavenRanges,
  isStableMavenVersion,
  mavenMajorDiffers,
  parseMavenRange,
  pickLatestStableMaven,
  satisfiesMavenRange,
} from "../../src/versions/maven-version.js";
import { compareWithVerified, pickLatestStable } from "../../src/versions/select.js";

describe("#39 AC-2: Maven の安定版の判定", () => {
  it.each([
    "1.0-SNAPSHOT",
    "1.0.0-alpha1",
    "1.0.0-Beta.2",
    "1.0.0.M1",
    "1.0.0-M12",
    "2.0.0-milestone-3",
    "1.0.0-RC1",
    "1.0.0.CR2",
    "3.0.0-preview",
    "21-ea",
    "1.0.0-dev",
  ])("試験版：%s", (v) => {
    expect(isStableMavenVersion(v)).toBe(false);
  });

  it.each(["1.0.0", "1.10", "1.0.Final", "1.0.0.GA", "1.0.0.RELEASE", "33.0.0-jre", "20231013"])(
    "安定版：%s",
    (v) => {
      expect(isStableMavenVersion(v)).toBe(true);
    },
  );

  it("数字で始まらない版は、安定版として扱わない（無視する）", () => {
    expect(isStableMavenVersion("latest")).toBe(false);
    expect(pickLatestStableMaven(["latest", "abc", "1.0.0"])).toBe("1.0.0");
  });
});

describe("#39 AC-2: Maven の版の順序", () => {
  it("数字は数として比べる（1.10 > 1.9）", () => {
    expect(compareMavenVersions("1.10", "1.9")).toBeGreaterThan(0);
    expect(compareMavenVersions("1.9", "1.10")).toBeLessThan(0);
  });

  it("修飾子なし = Final = GA = RELEASE。末尾の 0 も同じ", () => {
    expect(compareMavenVersions("1.0.0", "1.0.Final")).toBe(0);
    expect(compareMavenVersions("1.0", "1.0.GA")).toBe(0);
    expect(compareMavenVersions("1.0", "1.0.0.RELEASE")).toBe(0);
  });

  it("試験版は、同じ数字の正式版より前", () => {
    expect(compareMavenVersions("1.0.0-RC1", "1.0.0")).toBeLessThan(0);
    expect(compareMavenVersions("1.0.0-alpha1", "1.0.0-beta1")).toBeLessThan(0);
    expect(compareMavenVersions("1.0.0-RC1", "1.0.0-RC2")).toBeLessThan(0);
  });

  it("最新の安定版を選ぶ（試験版・順序の入れ替わりがあっても）", () => {
    const versions = ["1.9", "1.10", "2.0.0-RC1", "1.2.Final", "1.10.1-SNAPSHOT"];
    expect(pickLatestStableMaven(versions)).toBe("1.10");
    expect(pickLatestStable(versions, undefined, "maven")).toBe("1.10");
  });

  it("majorDiffers は先頭の数字の違い", () => {
    expect(mavenMajorDiffers("1.9", "1.10")).toBe(false);
    expect(mavenMajorDiffers("25", "29")).toBe(true);
    expect(compareWithVerified("25", "29", "maven")).toEqual({ kind: "newer", majorDiffers: true });
    expect(compareWithVerified("1.9", "1.10", "maven")).toEqual({
      kind: "newer",
      majorDiffers: false,
    });
    expect(compareWithVerified("1.0.Final", "1.0", "maven").kind).toBe("same");
  });
});

describe("#39 AC-2: Maven の範囲（>=X <Y）", () => {
  it("形が誤っているもの・X が Y 以上のものは読めない", () => {
    for (const bad of [
      "^21",
      ">=21",
      ">=21 <21",
      ">=27 <21",
      ">= 21 < 27",
      ">=21  <27",
      ">=a <b",
    ]) {
      expect(parseMavenRange(bad)).toBeUndefined();
    }
    expect(parseMavenRange(">=21 <27")).toEqual({ min: "21", max: "27" });
  });

  it("範囲に合う最大の安定版を選ぶ（上限は含まない）", () => {
    expect(satisfiesMavenRange("26", ">=21 <27")).toBe(true);
    expect(satisfiesMavenRange("27", ">=21 <27")).toBe(false);
    expect(satisfiesMavenRange("17", ">=21 <27")).toBe(false);
    expect(pickLatestStableMaven(["17", "21", "25", "29"], ">=21 <27")).toBe("25");
    expect(pickLatestStableMaven(["17", "29"], ">=21 <27")).toBeUndefined();
  });

  it("範囲の交わり（下限は大きい方、上限は小さい方）。空なら undefined", () => {
    expect(intersectMavenRanges(">=17 <27", ">=21 <30")).toBe(">=21 <27");
    expect(intersectMavenRanges(">=17 <21", ">=21 <30")).toBeUndefined();
  });
});
