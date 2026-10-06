// #42 R3：技術プロファイルの container_images（Docker のイメージの版・ダイジェスト・確かめた日と方法）
import { afterAll, describe, expect, it } from "vitest";
import { GenerateError } from "../../src/generate/errors.js";
import { loadProfile } from "../../src/generate/profile.js";
import { cleanupTemplates, makeTemplates, realTemplatesDir } from "./helpers.js";

afterAll(cleanupTemplates);

const DIGEST = `sha256:${"a".repeat(64)}`;

const ALPHA_YAML = `id: alpha
category: lib
name: Alpha
skill_name: lib-alpha
files:
  files/a.ts: out/a.ts
`;

function image(over: Record<string, string> = {}): string {
  const fields = {
    image: "example.invalid/tool/tool",
    tag: "1.2.3",
    digest: DIGEST,
    checked_on: "2026-10-06",
    note: "docker pull で確かめた",
    ...over,
  };
  return Object.entries(fields)
    .map(([key, value], i) => `${i === 0 ? "  tool_a:\n    " : "    "}${key}: "${value}"`)
    .join("\n");
}

function alpha(containerImages: string): string {
  return makeTemplates({
    "profiles/lib/alpha/profile.yaml": `${ALPHA_YAML}container_images:\n${containerImages}\n`,
    "profiles/lib/alpha/files/a.ts": "export const a = 1;\n",
    "profiles/lib/alpha/SKILL.md": "# alpha\n",
  });
}

describe("#42 R3：container_images の読み込み", () => {
  it("正しい形なら、道具の名前をキーにして読める", () => {
    const profile = loadProfile(alpha(image()), "lib/alpha");
    expect(profile.containerImages).toEqual({
      tool_a: {
        image: "example.invalid/tool/tool",
        tag: "1.2.3",
        digest: DIGEST,
        checkedOn: "2026-10-06",
        note: "docker pull で確かめた",
      },
    });
  });

  it("書いていないプロファイルは空のオブジェクトになる", () => {
    const dir = makeTemplates({
      "profiles/lib/alpha/profile.yaml": ALPHA_YAML,
      "profiles/lib/alpha/files/a.ts": "x\n",
      "profiles/lib/alpha/SKILL.md": "# alpha\n",
    });
    expect(loadProfile(dir, "lib/alpha").containerImages).toEqual({});
  });

  it.each([
    ["sha256: が無い", { digest: "a".repeat(64) }],
    ["桁が足りない", { digest: `sha256:${"a".repeat(63)}` }],
    ["16進でない文字", { digest: `sha256:${"g".repeat(64)}` }],
  ])("ダイジェストの形が違う（%s）と、場所を示した GenerateError", (_name, over) => {
    const dir = alpha(image(over));
    expect(() => loadProfile(dir, "lib/alpha")).toThrow(GenerateError);
    expect(() => loadProfile(dir, "lib/alpha")).toThrow(/container_images.*tool_a.*digest/);
  });

  it("tag が latest や空だとエラー（固定にならない）", () => {
    expect(() => loadProfile(alpha(image({ tag: "latest" })), "lib/alpha")).toThrow(
      /container_images.*tool_a.*tag/,
    );
  });

  it("checked_on が日付（YYYY-MM-DD）でないとエラー", () => {
    expect(() => loadProfile(alpha(image({ checked_on: "昨日" })), "lib/alpha")).toThrow(
      /container_images.*tool_a.*checked_on/,
    );
  });

  it("必須の項目（note）が無いとエラー", () => {
    const text = image().replace(/\n {4}note: .*/, "");
    expect(() => loadProfile(alpha(text), "lib/alpha")).toThrow(/container_images.*tool_a.*note/);
  });

  it("未知の項目はエラー（書き間違いの可能性）", () => {
    const text = `${image()}\n    digests: "x"`;
    expect(() => loadProfile(alpha(text), "lib/alpha")).toThrow(
      /container_images.*tool_a.*digests/,
    );
  });

  it("道具の名前が値の名前（小文字・数字・_）でないとエラー", () => {
    const text = image().replace("tool_a", "Tool-A");
    expect(() => loadProfile(alpha(text), "lib/alpha")).toThrow(/container_images.*Tool-A/);
  });

  it("container_images が連想配列でないとエラー", () => {
    const dir = makeTemplates({
      "profiles/lib/alpha/profile.yaml": `${ALPHA_YAML}container_images: [a]\n`,
      "profiles/lib/alpha/files/a.ts": "x\n",
      "profiles/lib/alpha/SKILL.md": "# alpha\n",
    });
    expect(() => loadProfile(dir, "lib/alpha")).toThrow(/container_images/);
  });
});

describe("#42 AC-1：実際の品質チェックのプロファイルの container_images", () => {
  const profile = loadProfile(realTemplatesDir, "quality/typescript-standard");

  it("Semgrep・gitleaks・OSV-Scanner・Schemathesis の4つが、tag とダイジェストで固定されている", () => {
    expect(Object.keys(profile.containerImages).sort()).toEqual([
      "gitleaks",
      "osv_scanner",
      "schemathesis",
      "semgrep",
    ]);
    for (const [name, entry] of Object.entries(profile.containerImages)) {
      expect(entry.tag, name).toMatch(/^v?\d+\.\d+\.\d+$/);
      expect(entry.digest, name).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(entry.checkedOn, name).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.note, name).toContain("docker");
    }
  });
});
