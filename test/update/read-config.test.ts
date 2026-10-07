// #35 config.yaml の読み込みと検証。想定する型：src/update/read-config.ts
import { describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { ConfigError, parseConfig } from "../../src/update/read-config.js";
import { baseAnswers } from "../questions/helpers.js";
import { completeAnswers } from "../generate/project-helpers.js";

async function validDoc(): Promise<Record<string, unknown>> {
  return {
    harness_version: "0.1.0",
    generated_on: "2026-10-01",
    mode: "create",
    answers: await completeAnswers(),
    accepted_warnings: [{ id: "public-needs-ci", message: "m", reason: "r" }],
    versions: [
      {
        name: "node",
        version: "24.1.0",
        reason: "ハーネス検証済み",
        surveyed_on: "2026-10-01",
        latest_stable: null,
        verified: "24.1.0",
      },
    ],
    managed_files: { "CLAUDE.md": "a".repeat(64) },
  };
}

const text = (doc: Record<string, unknown>) => stringify(doc);

describe("#35 config.yaml の読み込み", () => {
  it("#35 正しい記録を読む（版・日付・回答・承知した警告・版の一覧・指紋・消したままのパス）", async () => {
    const doc = {
      ...(await validDoc()),
      removed_files: ["docs/secrets.md"],
      updated_on: "2026-10-02",
    };
    const c = parseConfig(text(doc));
    expect(c.harnessVersion).toBe("0.1.0");
    expect(c.generatedOn).toBe("2026-10-01");
    expect(c.updatedOn).toBe("2026-10-02");
    expect(c.answers.app_name).toBe(baseAnswers().app_name);
    expect(c.acceptedWarnings.map((w) => w.id)).toEqual(["public-needs-ci"]);
    expect(c.versions[0]).toMatchObject({ name: "node", version: "24.1.0", verified: "24.1.0" });
    expect(c.managedFiles).toEqual({ "CLAUDE.md": "a".repeat(64) });
    expect(c.removedFiles).toEqual(["docs/secrets.md"]);
  });

  it("#35 壊れた YAML は ConfigError", () => {
    expect(() => parseConfig("harness_version: [")).toThrow(ConfigError);
  });

  it("#35 必須の項目が無いと ConfigError（項目名を示す）", async () => {
    for (const key of ["harness_version", "generated_on", "answers", "managed_files", "versions"]) {
      const doc = await validDoc();
      delete doc[key];
      expect(() => parseConfig(text(doc)), key).toThrow(ConfigError);
      expect(() => parseConfig(text(doc)), key).toThrow(key);
    }
  });

  it("#35 harness_version が semver でなければ ConfigError", async () => {
    const doc = { ...(await validDoc()), harness_version: "とても新しい" };
    expect(() => parseConfig(text(doc))).toThrow(ConfigError);
  });

  it("#35 安全: managed_files のパスが ../ を含む・絶対パス・\\ を含む → ConfigError（読み書きしない）", async () => {
    for (const bad of ["../evil.md", "/etc/evil", "a\\b.md", "C:/evil.md", "a//b"]) {
      const doc = await validDoc();
      doc.managed_files = { [bad]: "a".repeat(64) };
      expect(() => parseConfig(text(doc)), bad).toThrow(ConfigError);
    }
  });

  it("#35 安全: removed_files のパスが誤っていても ConfigError", async () => {
    const doc = { ...(await validDoc()), removed_files: ["../evil.md"] };
    expect(() => parseConfig(text(doc))).toThrow(ConfigError);
  });

  it("#35 AC-4: 管理の対象でないパス（package.json など）の記録は無視し、ignored に入れる（更新の対象にしない）", async () => {
    const doc = await validDoc();
    doc.managed_files = { "CLAUDE.md": "a".repeat(64), "package.json": "b".repeat(64) };
    const c = parseConfig(text(doc));
    expect(Object.keys(c.managedFiles)).toEqual(["CLAUDE.md"]);
    expect(c.ignored).toEqual(["package.json"]);
  });

  it("#35 指紋が 64 桁の16進でなければ ConfigError", async () => {
    const doc = await validDoc();
    doc.managed_files = { "CLAUDE.md": "xyz" };
    expect(() => parseConfig(text(doc))).toThrow(ConfigError);
  });

  it("#35 回答に知らないキー・誤った値があれば ConfigError", async () => {
    const doc = await validDoc();
    doc.answers = { ...(doc.answers as object), colour: "red" };
    expect(() => parseConfig(text(doc))).toThrow(ConfigError);
    const doc2 = await validDoc();
    doc2.answers = { ...(doc2.answers as object), visibility: "secret" };
    expect(() => parseConfig(text(doc2))).toThrow(ConfigError);
  });

  it("#35 回答から質問が抜けていても読める（増えた質問として、あとで聞く）", async () => {
    const doc = await validDoc();
    const answers = { ...(doc.answers as Record<string, unknown>) };
    delete answers["check_location"];
    doc.answers = answers;
    expect(parseConfig(text(doc)).answers).not.toHaveProperty("check_location");
  });
});

describe("#15 R2: mode と marked_files の読み込み", () => {
  it("#15 R2: mode が無い記録は create として読む（後方互換）。marked_files は空", async () => {
    const doc = await validDoc();
    delete doc["mode"];
    const c = parseConfig(text(doc));
    expect(c.mode).toBe("create");
    expect(c.markedFiles).toEqual([]);
  });

  it.each(["create", "update", "adopt"])("#15 R2: mode: %s を受け付ける", async (mode) => {
    expect(parseConfig(text({ ...(await validDoc()), mode })).mode).toBe(mode);
  });

  it("#15 R2: 知らない mode は ConfigError", async () => {
    const base = await validDoc();
    expect(() => parseConfig(text({ ...base, mode: "other" }))).toThrow(ConfigError);
  });

  it("#15 R2: marked_files を読む（管理するファイルの記録にあるものだけ）", async () => {
    const doc = {
      ...(await validDoc()),
      mode: "adopt",
      managed_files: { "CLAUDE.md": "a".repeat(64), "AGENTS.md": "b".repeat(64) },
      marked_files: ["AGENTS.md", "CLAUDE.md"],
    };
    expect(parseConfig(text(doc)).markedFiles).toEqual(["AGENTS.md", "CLAUDE.md"]);
  });

  it("#15 R2: marked_files が一覧でない・使えないパスなら ConfigError", async () => {
    const base = await validDoc();
    expect(() => parseConfig(text({ ...base, marked_files: "AGENTS.md" }))).toThrow(ConfigError);
    expect(() => parseConfig(text({ ...base, marked_files: ["../outside.md"] }))).toThrow(
      ConfigError,
    );
  });
});
