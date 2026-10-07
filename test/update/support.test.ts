// #35 差分の表示・最新の版の取得・変更履歴・config.yaml の更新の書き方。想定する型は各 src/update/*.ts
import { describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { fingerprint, toUpdateConfigText } from "../../src/generate/config.js";
import { parseChangelog, changesSince } from "../../src/update/changelog.js";
import { formatDiff, settingChangeNotes } from "../../src/update/diff.js";
import {
  fetchLatestVersion,
  readOwnRepository,
  repositoryOf,
  type RunGh,
} from "../../src/update/latest.js";

describe("#35 差分の表示", () => {
  it("#35 AC-2: 現在の中身と新しい内容の差分（行ごと）を出す。改行の違いだけでは差分にしない", () => {
    const text = formatDiff("CLAUDE.md", "一行目\r\n二行目\r\n", "一行目\n二行目（新）\n");
    expect(text).toContain("-二行目");
    expect(text).toContain("+二行目（新）");
    expect(text).not.toContain("-一行目");
    expect(text).toContain("CLAUDE.md");
  });

  it("#35 差分が長すぎるときは、先頭だけを出して、省いた行数を知らせる", () => {
    const next = Array.from({ length: 1000 }, (_, i) => `行${String(i)}`).join("\n");
    const text = formatDiff("CLAUDE.md", "", `${next}\n`);
    expect(text.split("\n").length).toBeLessThan(400);
    expect(text).toMatch(/省略/);
  });
});

describe("#35 管理しない設定の変化は、知らせるだけ", () => {
  const pkg = (scripts: Record<string, string>) =>
    `${JSON.stringify({ name: "testapp-001", scripts, dependencies: { hono: "4.0.0" } }, null, 2)}\n`;

  it("#35 AC-4: 新しい package.json に、今の package.json に無い・違う scripts があれば知らせる", () => {
    const notes = settingChangeNotes(
      [{ path: "package.json", content: pkg({ check: "new-check", lint: "eslint ." }) }],
      new Map([["package.json", { kind: "file", text: pkg({ check: "old-check" }) }]]),
    );
    expect(notes.join("\n")).toContain("package.json");
    expect(notes.join("\n")).toContain("scripts.check");
    expect(notes.join("\n")).toContain("scripts.lint");
  });

  it("#35 変わらなければ、何も知らせない", () => {
    const same = pkg({ check: "x" });
    expect(
      settingChangeNotes(
        [{ path: "package.json", content: same }],
        new Map([["package.json", { kind: "file", text: same }]]),
      ),
    ).toEqual([]);
  });

  it("#35 wrangler.jsonc が新しいひな形と違えば知らせる。ファイルが無ければ「ありません」と知らせる", () => {
    const notes = settingChangeNotes(
      [{ path: "wrangler.jsonc", content: "{}\n" }],
      new Map([["wrangler.jsonc", { kind: "file", text: '{"a":1}\n' }]]),
    );
    expect(notes.join("\n")).toContain("wrangler.jsonc");
    const none = settingChangeNotes(
      [{ path: "wrangler.jsonc", content: "{}\n" }],
      new Map([["wrangler.jsonc", { kind: "absent" }]]),
    );
    expect(none.join("\n")).toContain("ありません");
  });
});

describe("#35 リポジトリの読み取り", () => {
  it("#35 package.json の repository のさまざまな書き方から 持ち主/名前 を取り出す（架空の名前）", () => {
    expect(repositoryOf("github:testowner/harness")).toBe("testowner/harness");
    expect(repositoryOf("testowner/harness")).toBe("testowner/harness");
    expect(repositoryOf({ type: "git", url: "git+https://github.com/testowner/harness.git" })).toBe(
      "testowner/harness",
    );
    expect(repositoryOf("git@github.com:testowner/harness.git")).toBe("testowner/harness");
    expect(repositoryOf("https://github.com/testowner/harness")).toBe("testowner/harness");
  });

  it("#35 repository が無い・読めない・怪しい文字を含むときは undefined（コマンドに渡さない）", () => {
    expect(repositoryOf(undefined)).toBeUndefined();
    expect(repositoryOf("")).toBeUndefined();
    expect(repositoryOf({})).toBeUndefined();
    expect(repositoryOf("a b/c; rm -rf")).toBeUndefined();
    expect(repositoryOf("--repo=x/y")).toBeUndefined();
  });

  it("#36 リポジトリは既定で ysteam0117/harness。環境変数 HARNESS_REPOSITORY で変えられる（架空の名前）。形が違うときは undefined", () => {
    expect(readOwnRepository({ HARNESS_REPOSITORY: "testowner/harness" })).toBe(
      "testowner/harness",
    );
    expect(readOwnRepository({ HARNESS_REPOSITORY: " testowner/harness " })).toBe(
      "testowner/harness",
    );
    expect(readOwnRepository({})).toBe("ysteam0117/harness");
    expect(readOwnRepository({ HARNESS_REPOSITORY: "" })).toBe("ysteam0117/harness");
    expect(readOwnRepository({ HARNESS_REPOSITORY: "a b/c; rm -rf" })).toBeUndefined();
  });
});

describe("#35 最新の版（GitHub の Release）", () => {
  const ghReturning =
    (result: { code: number | null; stdout?: string; stderr?: string }): RunGh =>
    async () => ({ stdout: "", stderr: "", ...result });

  it("#35 AC-5: gh release view の tagName から、先頭の v を除いた版を返す。時間切れは5秒、リポジトリを --repo で渡す", async () => {
    const calls: { args: string[]; timeout: number }[] = [];
    const runGh: RunGh = async (args, timeout) => {
      calls.push({ args, timeout });
      return { code: 0, stdout: JSON.stringify({ tagName: "v1.2.3" }), stderr: "" };
    };
    const r = await fetchLatestVersion("testowner/harness", runGh);
    expect(r).toEqual({ ok: true, version: "1.2.3" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.timeout).toBe(5000);
    expect(calls[0]?.args).toEqual([
      "release",
      "view",
      "--repo",
      "testowner/harness",
      "--json",
      "tagName",
    ]);
  });

  it("#35 AC-5: gh が無い（code が null）・ログインしていない・Release が無い・壊れた出力は、ok: false と理由（例外にしない）", async () => {
    for (const run of [
      ghReturning({ code: null, stderr: "spawn gh ENOENT" }),
      ghReturning({ code: 4, stderr: "gh auth login を実行してください" }),
      ghReturning({ code: 1, stderr: "release not found" }),
      ghReturning({ code: 0, stdout: "これは JSON ではありません" }),
      ghReturning({ code: 0, stdout: JSON.stringify({ tagName: "最新版" }) }),
    ]) {
      const r = await fetchLatestVersion("testowner/harness", run);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason.length).toBeGreaterThan(0);
    }
  });

  it("#35 gh が例外を投げても、ok: false（終了コード0のまま表示できる）", async () => {
    const r = await fetchLatestVersion("testowner/harness", async () => {
      throw new Error("ネットワークにつながりません");
    });
    expect(r.ok).toBe(false);
  });

  it("#35 リポジトリが分からないときは、gh を呼ばずに ok: false", async () => {
    let called = false;
    const r = await fetchLatestVersion(undefined, async () => {
      called = true;
      return { code: 0, stdout: "", stderr: "" };
    });
    expect(called).toBe(false);
    expect(r.ok).toBe(false);
  });
});

describe("#35 変更履歴", () => {
  const text = [
    "# 変更履歴",
    "",
    "## 0.2.0",
    "- 追加：Skill",
    "",
    "## 0.1.0",
    "- 初回",
    "",
    "## 0.10.0",
    "- 十番目",
    "",
    "## 0.0.0",
    "- 最初",
  ].join("\n");

  it("#35 AC-5: ## x.y.z の見出しで分ける", () => {
    const entries = parseChangelog(text);
    expect(entries.map((e) => e.version)).toEqual(["0.2.0", "0.1.0", "0.10.0", "0.0.0"]);
    expect(entries[0]?.body).toContain("追加：Skill");
  });

  it("#35 AC-5: このプロジェクトの版より新しい項目だけを、新しい順（semver）に返す", () => {
    const entries = changesSince(parseChangelog(text), "0.1.0");
    expect(entries.map((e) => e.version)).toEqual(["0.10.0", "0.2.0"]);
  });

  it("#35 見出しに日付や角括弧が付いていても版を読める", () => {
    const entries = parseChangelog("## [1.0.0] - 2026-01-01\n- a\n");
    expect(entries.map((e) => e.version)).toEqual(["1.0.0"]);
  });
});

describe("#35 config.yaml の更新の書き方（toUpdateConfigText）", () => {
  const created = `# 見出し\n${stringify({
    harness_version: "0.2.0",
    generated_on: "2026-10-03",
    mode: "create",
    answers: { app_name: "testapp-001" },
    managed_files: { "a.md": "x" },
    roles: {},
  })}`;

  it("#35 mode は update、generated_on は引き継ぎ、updated_on を足す。指紋は渡したものにする（パスの順）", () => {
    const out = toUpdateConfigText(created, {
      generatedOn: "2026-01-01",
      updatedOn: "2026-10-05",
      managedFiles: { "b.md": fingerprint("b"), "a.md": fingerprint("a") },
      removedFiles: [],
    });
    const doc = parse(out) as Record<string, unknown>;
    expect(doc["mode"]).toBe("update");
    expect(doc["generated_on"]).toBe("2026-01-01");
    expect(doc["updated_on"]).toBe("2026-10-05");
    expect(doc["harness_version"]).toBe("0.2.0");
    expect(Object.keys(doc["managed_files"] as object)).toEqual(["a.md", "b.md"]);
    expect(doc).not.toHaveProperty("removed_files");
    expect(out.startsWith("#")).toBe(true);
  });

  it("#35 R1: removed_files は、あるときだけ書く（パスの順）", () => {
    const out = toUpdateConfigText(created, {
      generatedOn: "2026-01-01",
      updatedOn: "2026-10-05",
      managedFiles: {},
      removedFiles: ["z.md", "b.md"],
    });
    expect((parse(out) as Record<string, unknown>)["removed_files"]).toEqual(["b.md", "z.md"]);
  });
});
