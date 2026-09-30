// Web E2E のコンソールの監視（C-24）。エラーレベルのコンソール出力と、処理されなかった例外があれば失敗にする。
import { test as base, expect, type Page } from "@playwright/test";

const allowedByPage = new WeakMap<Page, RegExp[]>();

// テストが意図して起こすエラーだけを、そのテストの中で許可する。理由を必ず書く
export function allowConsoleError(
  page: Page,
  message: RegExp,
  reason: string,
): void {
  if (reason.trim() === "") throw new Error("許可する理由を書いてください");
  allowedByPage.set(page, [...(allowedByPage.get(page) ?? []), message]);
}

export const test = base.extend({
  page: async ({ page }, use) => {
    const errors: string[] = [];
    const isAllowed = (text: string) =>
      (allowedByPage.get(page) ?? []).some((re) => re.test(text));
    page.on("console", (m) => {
      if (m.type() === "error" && !isAllowed(m.text())) errors.push(m.text());
    });
    page.on("pageerror", (e) => {
      if (!isAllowed(String(e))) errors.push(String(e));
    });
    await use(page);
    expect(errors, "コンソールのエラー・処理されなかった例外").toEqual([]);
  },
});

export { expect };
