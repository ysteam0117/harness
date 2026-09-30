import { describe, it, expect, vi } from "vitest";
import { createLogger, redact } from "./logger";

describe("共通ロガー（C-30）", () => {
  it("秘密情報・個人情報の項目は、元の値を出力しない", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    createLogger({ traceId: "trace-001", userId: "user-001" }).info(
      "ログイン",
      {
        password: "dummy-password-for-test",
        accessToken: "dummy-token-for-test",
        Authorization: "Bearer dummy",
        email: "testuser_001@example.com",
        nested: { sessionId: "dummy-session" },
      },
    );
    const out = spy.mock.calls[0][0] as string;
    for (const v of [
      "dummy-password-for-test",
      "dummy-token-for-test",
      "Bearer dummy",
      "testuser_001@example.com",
      "dummy-session",
    ]) {
      expect(out).not.toContain(v);
    }
    expect(JSON.parse(out)).toMatchObject({
      severity_text: "INFO",
      trace_id: "trace-001",
      user_id: "user-001",
    });
    spy.mockRestore();
  });

  it("改行などの制御文字を無害化する（ログインジェクション対策）", () => {
    expect(redact("line1\nFAKE LOG LINE")).not.toContain("\n");
  });

  it("例外は名前とメッセージだけにする", () => {
    expect(redact(new Error("失敗"))).toEqual({
      name: "Error",
      message: "失敗",
    });
  });

  it("監査ログには log_type: audit が付く", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    createLogger().audit("権限の変更", "user:2", "success");
    expect(JSON.parse(spy.mock.calls[0][0] as string).attributes).toMatchObject(
      { log_type: "audit", target: "user:2", result: "success" },
    );
    spy.mockRestore();
  });
});
