import { describe, expect, it } from "vitest";
import { codeOf, messageOf } from "../../src/generate/errors.js";

describe("C-38 #76: 例外から値を取り出す共通の関数", () => {
  it("C-38 #76 AC-1: messageOf は、Error なら message を、Error でなければ文字列にした値を返す", () => {
    expect(messageOf(new Error("x"))).toBe("x");
    expect(messageOf("y")).toBe("y");
    expect(messageOf(42)).toBe("42");
    expect(messageOf(null)).toBe("null");
  });

  it("C-38 #76 AC-1: codeOf は、code を持つ例外なら code を、持たない・オブジェクトでない値なら undefined を返す", () => {
    expect(codeOf(Object.assign(new Error("x"), { code: "ENOENT" }))).toBe("ENOENT");
    expect(codeOf(new Error("x"))).toBeUndefined();
    expect(codeOf(null)).toBeUndefined();
    expect(codeOf("ENOENT")).toBeUndefined();
  });
});
