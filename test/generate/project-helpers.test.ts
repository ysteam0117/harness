// #84 baselineFingerprint の確認（ハーネス自身の開発の道具のため、要件の番号は付けない）。値は架空のもの。

import { describe, expect, it } from "vitest";
import { CONFIG_PATH, fingerprint } from "../../src/generate/config.js";
import { baselineFingerprint } from "./project-helpers.js";

const config = (version: string, name = "sample-project"): string =>
  `schema: 1\nharness_version: ${version}\nproject: ${name}\n`;

describe("baselineFingerprint", () => {
  it("#84 AC-1: baselineFingerprint は、.harness/config.yaml の harness_version が違っても、同じ指紋を返す", () => {
    const old = baselineFingerprint({ path: CONFIG_PATH, content: config("0.0.1") });
    const next = baselineFingerprint({ path: CONFIG_PATH, content: config("9.9.9") });
    expect(next).toBe(old);
    expect(old).toBe(fingerprint(config("0.0.1")));
  });

  it("#84 AC-2: baselineFingerprint は、harness_version 以外の中身が違えば、違う指紋を返す", () => {
    const a = baselineFingerprint({ path: CONFIG_PATH, content: config("9.9.9") });
    const b = baselineFingerprint({ path: CONFIG_PATH, content: config("9.9.9", "other-project") });
    expect(b).not.toBe(a);

    const other = { path: "docs/note.md", content: config("9.9.9") };
    expect(baselineFingerprint(other)).toBe(fingerprint(other.content));
  });

  it("#84 AC-3: baselineFingerprint は、harness_version の行がちょうど1つでなければ、例外を投げる", () => {
    expect(() => baselineFingerprint({ path: CONFIG_PATH, content: "schema: 1\n" })).toThrow(
      "0 行",
    );
    const twice = `${config("0.0.1")}harness_version: 0.0.1\n`;
    expect(() => baselineFingerprint({ path: CONFIG_PATH, content: twice })).toThrow("2 行");
  });
});
