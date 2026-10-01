// 想定する型：src/questions/app-name.ts
//   export function validateAppName(name: string): string | undefined;   // 問題がなければ undefined、あれば日本語の理由
import { describe, expect, it } from "vitest";
import { validateAppName } from "../../src/questions/app-name.js";

describe("#32 AC-1: validateAppName（R2・R4）", () => {
  const ok = ["testapp-001", "a", "a1", "ab-c", "a--b", "1app", "x".repeat(100)];
  for (const name of ok) {
    it(`#32 AC-1: 「${name.length > 20 ? "100文字の名前" : name}」は有効（長さ・連続したハイフンの制限は付けない）`, () => {
      expect(validateAppName(name)).toBeUndefined();
    });
  }

  const ng: [string, string][] = [
    ["空", ""],
    ["先頭がハイフン", "-abc"],
    ["末尾がハイフン", "abc-"],
    ["ハイフンだけ", "-"],
    ["大文字を含む", "Testapp"],
    ["アンダースコアを含む", "test_app"],
    ["日本語を含む", "テスト太郎"],
    ["スペースを含む", "test app"],
    ["親フォルダへの参照", "../x"],
    ["スラッシュを含む", "a/b"],
    ["バックスラッシュを含む", String.raw`a\b`],
    ["NUL 文字を含む", "a\0b"],
    ["ドットを含む", "a.b"],
  ];
  for (const [label, name] of ng) {
    it(`#32 AC-1: ${label}は無効で、日本語の理由を返す`, () => {
      const message = validateAppName(name);
      expect(message).toBeTruthy();
      expect(message).toMatch(/[ぁ-んァ-ヶ一-龠]/);
    });
  }
});
