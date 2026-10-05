// Skill「logger」の例：ログは共通ロガーで出す。console.log で、秘密の値をそのまま出さない。
// Skill の書き方の例なので、消さない。ハーネスが管理するファイルで、ハーネスの更新で置き換わる。
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "../lib/logger/logger";

type Login = { userId: string; token: string };

// #region example:use-logger
export function logLogin(login: Login): void {
  // 共通ロガーを使う。token・password などの項目は、自動で伏せ字（[REDACTED]）になる
  createLogger().info("ログインした", login);
}
// #endregion

// #region example:console-log-bad
export function logLoginBad(login: Login): void {
  // 悪い例：console.log でそのまま出している。token の値がログに残る
  console.log("ログインした", login);
}
// #endregion

const login: Login = { userId: "testuser_001", token: "FAKE_SECRET_FOR_TEST" };

/** console.log に出た内容を、文字列にして集める */
function captureLog(run: () => void): string {
  const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  run();
  return spy.mock.calls.map((args) => JSON.stringify(args)).join("\n");
}

afterEach(() => vi.restoreAllMocks());

describe("ログに秘密の値を出さない", () => {
  it("良い例：token は伏せ字になり、値はログに出ない", () => {
    const output = captureLog(() => logLogin(login));
    expect(output).toContain("testuser_001");
    expect(output).toContain("[REDACTED]");
    expect(output).not.toContain("FAKE_SECRET_FOR_TEST");
  });

  it("悪い例の問題：console.log では、token の値がそのままログに残る", () => {
    const output = captureLog(() => logLoginBad(login));
    expect(output).toContain("FAKE_SECRET_FOR_TEST");
  });
});
