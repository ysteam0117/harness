import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (file: string): string =>
  readFileSync(new URL(`../../${file}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const description = "ハーネスのバージョン・主な変更点・Claude Code の承認設定を表示する";
const oldDescription = "今のハーネスのバージョン・最新のバージョン・主な変更点を表示する";

describe("F-27 F-28 C-75 C-66 #99 AC-4: 利用と更新の説明", () => {
  it("README のコマンド表・リンク・使い方に診断を示す", () => {
    const text = read("README.md");
    expect(text).toMatch(/^\| `harness status`[^\n]+Claude Code の承認設定/m);
    expect(text).toContain("[`harness status` の使い方](#harness-status-の使い方)");
    expect(text).not.toContain(
      "`harness update`・`harness status` の使い方は、[`harness update` の使い方]",
    );
    expect(text).not.toContain("プロジェクトでないフォルダでは、ハーネスの情報だけ");
    for (const phrase of [
      "settings.local.json",
      "~/.claude/settings.json",
      "permissions.defaultMode",
      "acceptEdits",
      "auto",
      "bypassPermissions",
      "前回の選択",
      "登録情報",
      "GitHub の Release",
    ])
      expect(text).toContain(phrase);
  });

  it("F-27 の案内と F-28 の表・インストール案内に診断を示す", () => {
    const text = read("docs/requirements/functional.md");
    expect(text).toMatch(/状態の確認[^\n]+Claude Code の承認設定/);
    expect(text).toContain(`| \`harness status\` | ${description}`);
    expect(text).toMatch(/同じインストールのコマンド[^\n]+承認設定/);
    expect(text).toMatch(/`harness status`は、最新のバージョンを[^\n]+HARNESS_REPOSITORY/);
    expect(text).toContain("起動時のモードを利用者が画面で確かめ");
    expect(text).not.toContain(oldDescription);
    expect(text).not.toContain("今のバージョン・最新のバージョン・主な変更点を表示する\n");
    expect(text).not.toContain("（`harness status`で、新しいバージョンがあるかを確かめる）");
  });

  it("設計の要約・処理の流れ・AC・差し込み口・処理の説明をそろえる", () => {
    const overview = read("docs/design/overview.md");
    expect(overview).toMatch(/^\| `status`[^\n]+Claude Code の承認設定[^\n]+実装済み/m);
    expect(overview).toMatch(/src\/commands\/[^\n]+status[^\n]+承認設定/);
    expect(overview).not.toContain(oldDescription);
    expect(overview).not.toContain("`update`・`status` は未実装の表示のみ");

    const update = read("docs/design/update.md");
    for (const pattern of [
      /^`harness update`[^\n]+Claude Code の承認設定/m,
      /^\| AC-5 [^\n]+Claude Code の承認設定/m,
      /^\| `src\/commands\/status\.ts`[^\n]+homeDirectory/m,
      /^\| `src\/commands\/status-approval\.ts`[^\n]+permissions\.defaultMode/m,
      /config\.yaml[^\n]+ないフォルダ[^\n]+承認設定/,
      /リンク[^\n]+たどら/,
      /管理記録[^\n]+終了コードは1/,
    ])
      expect(update).toMatch(pattern);
    expect(update).not.toContain(
      "今のバージョン・最新のバージョン・主な変更点を表示する（F-27・F-28）",
    );
    expect(update).not.toContain("今のバージョン・最新のバージョン・主な変更点が表示される |");
    expect(update).not.toContain("ハーネス（CLI）の情報だけを表示する");
    expect(update).not.toContain("runGh・repository・changelog・harnessVersion・fs・fetch）");
  });

  it("C-75 と C-66 にツールの許可状態にかかわらない承認手順がある", () => {
    const one = read("docs/requirements/common/design-principles.md");
    const other = read("docs/requirements/common/workflow.md");
    for (const text of [one, other]) {
      expect(text).toContain("必要な承認を得るまで操作を保留する");
      expect(text).toContain(
        "モードの確認や切り替えのために手元や利用者の設定ファイルを読み書きしない",
      );
    }
    const settings = one.split("### AIの設定による守り")[1]?.split("### 何重にも守る")[0] ?? "";
    expect(settings).toContain("危険なコマンドに確認を求め");
    expect(settings.indexOf("| 禁止する")).toBeGreaterThan(-1);
    expect(settings.indexOf("手元の設定や起動時の指定")).toBeGreaterThan(
      settings.indexOf("| 禁止する"),
    );
    expect(settings).toContain(
      "統括はモードが不明ならセッションの初めに一度だけ利用者に確認を頼み",
    );
    expect(settings).toContain("担当は統括に報告する");
    for (const text of [one, other]) expect(text).not.toContain("読み書きしない。 ");
    expect(other).toContain("状態が分からない担当は重複起動しない");
    expect(other).not.toContain("やAIの設定が承認を求める操作を実行せず、統括へ");
  });

  it("版と変更履歴に診断・管理ファイル・手元の設定の扱いがある", () => {
    const changelog = read("CHANGELOG.md");
    const current = changelog.match(/^## (\d+\.\d+\.\d+)$/m)?.[1];
    expect(current).toBeDefined();
    expect(JSON.parse(read("package.json"))).toMatchObject({ version: current });
    expect(JSON.parse(read("package-lock.json"))).toMatchObject({
      version: current,
      packages: { "": { version: current } },
    });
    const release = changelog.match(/^## 0\.6\.0\n([\s\S]*?)^## /m)?.[1] ?? "";
    for (const phrase of [
      "Claude Code の承認設定",
      "permissions.defaultMode",
      "auto",
      "harness update",
      ".harness-new",
      "管理外",
      "手動",
      ".claude/settings.local.json",
      "~/.claude/settings.json",
    ])
      expect(release).toContain(phrase);
  });
});
