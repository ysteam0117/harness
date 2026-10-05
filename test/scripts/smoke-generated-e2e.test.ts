// #64：smoke（scripts/smoke-generated.ts）の E2E・Terraform の段階の判断の単体のテスト。
// 実際の実行（ブラウザ・terraform）は CI と smoke:generated で行う。ここでは判断の部品だけを確かめる。
//
// 想定する関数（scripts/smoke-generated.ts が export する）
//   decideTerraformStep(available: boolean, env): "run" | "skip"
//        terraform がなければ "skip"。ただし SMOKE_REQUIRE_TERRAFORM=1 のときは、Error（日本語）にする
//   shouldRunE2e(env): boolean            SMOKE_SKIP_E2E=1 のとき false
//   playwrightInstallArgs(env): string[]  CI（CI=true）では --with-deps を付ける
import { describe, expect, it } from "vitest";
import {
  decideTerraformStep,
  playwrightInstallArgs,
  shouldRunE2e,
} from "../../scripts/smoke-generated.js";

describe("#64 smoke：Terraform の段階", () => {
  it("terraform があれば実行する", () => {
    expect(decideTerraformStep(true, {})).toBe("run");
    expect(decideTerraformStep(true, { SMOKE_REQUIRE_TERRAFORM: "1" })).toBe("run");
  });

  it("terraform がなければ飛ばす", () => {
    expect(decideTerraformStep(false, {})).toBe("skip");
  });

  it("SMOKE_REQUIRE_TERRAFORM=1 で terraform がなければ失敗にする", () => {
    expect(() => decideTerraformStep(false, { SMOKE_REQUIRE_TERRAFORM: "1" })).toThrow(/terraform/);
  });
});

describe("#64 smoke：E2E の段階", () => {
  it("既定では実行する。SMOKE_SKIP_E2E=1 で飛ばす", () => {
    expect(shouldRunE2e({})).toBe(true);
    expect(shouldRunE2e({ SMOKE_SKIP_E2E: "1" })).toBe(false);
  });

  it("ブラウザの導入は chromium だけ。CI では --with-deps を付ける", () => {
    expect(playwrightInstallArgs({})).toEqual(["playwright", "install", "chromium"]);
    expect(playwrightInstallArgs({ CI: "true" })).toEqual([
      "playwright",
      "install",
      "--with-deps",
      "chromium",
    ]);
  });
});
