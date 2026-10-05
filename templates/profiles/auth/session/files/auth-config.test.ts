import { describe, expect, it } from "vitest";
import { loadAuthConfig } from "./auth-config";

const secret = () => crypto.randomUUID();

describe("loadAuthConfig", () => {
  it("SESSION_SECRET と APP_ENV から、設定を作る（本番だけ production）", () => {
    const key = secret();
    expect(
      loadAuthConfig({ APP_ENV: "production", SESSION_SECRET: key }),
    ).toEqual({
      sessionSecret: key,
      production: true,
    });
    expect(
      loadAuthConfig({ APP_ENV: "development", SESSION_SECRET: key })
        .production,
    ).toBe(false);
    expect(
      loadAuthConfig({ APP_ENV: "test", SESSION_SECRET: key }).production,
    ).toBe(false);
  });

  it("SESSION_SECRET がない・短いときは、値を表示せずにエラーにする", () => {
    for (const value of [undefined, "", "short"]) {
      const env = { APP_ENV: "test", SESSION_SECRET: value };
      expect(() => loadAuthConfig(env)).toThrow("SESSION_SECRET");
      expect(() => loadAuthConfig(env)).toThrow("値は表示しません");
    }
  });
});
