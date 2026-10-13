// #40：Spring Boot と、デプロイ先・DB・認証の組み合わせの整合性ルール（F-08）4つの、当たる・当たらない。
import { describe, expect, it } from "vitest";
import { evaluateRules, loadRules, type Facts } from "../../src/checks/rules.js";
import { baseAnswers } from "../questions/helpers.js";

const NO_FACTS: Facts = {
  versions_newer_than_verified: false,
  missing_tools: [],
  target_dir_not_empty: false,
  invalid_app_name: false,
};
const rules = loadRules();

function errorIds(over: Record<string, unknown>): string[] {
  return evaluateRules(rules, baseAnswers(over), NO_FACTS).errors.map((h) => h.id);
}

const SPRING = { backend: "spring_boot", infra: "container", database: "none", auth: "none" };

describe("#40: Spring Boot の組み合わせのルール", () => {
  it("Spring Boot × container × DB なし × 認証なしは、どのルールにも当たらない", () => {
    expect(errorIds(SPRING)).toEqual([]);
  });

  it("Spring Boot × PostgreSQL × 認証が未定も、当たらない", () => {
    expect(
      errorIds({ ...SPRING, database: "postgresql", postgres_provider: "neon", auth: "undecided" }),
    ).toEqual([]);
  });

  it("spring-boot-on-workers：Spring Boot × Cloudflare", () => {
    expect(errorIds({ ...SPRING, infra: "cloudflare" })).toEqual(["spring-boot-on-workers"]);
  });

  it("hono-needs-workers：Hono × コンテナ", () => {
    expect(errorIds({ backend: "hono", infra: "container" })).toEqual(["hono-needs-workers"]);
  });

  it("spring-boot-with-d1：Spring Boot × D1", () => {
    expect(errorIds({ ...SPRING, database: "d1" })).toEqual(["spring-boot-with-d1"]);
  });

  it.each(["app", "oidc", "both"])("spring-boot-with-auth：Spring Boot × 認証 %s", (auth) => {
    const ids = errorIds({
      ...SPRING,
      database: "postgresql",
      postgres_provider: "neon",
      auth,
      ...(auth === "app" ? {} : { idp: "google" }),
    });
    expect(ids).toEqual(["spring-boot-with-auth"]);
  });

  it("Hono × Cloudflare は、これらのルールに当たらない", () => {
    expect(errorIds({ backend: "hono", infra: "cloudflare" })).toEqual([]);
  });

  it("4つのルールはエラーで、直す質問は backend と、もう一方の質問", () => {
    const fix = (id: string) => rules.find((r) => r.id === id)?.fix;
    expect(fix("spring-boot-on-workers")).toEqual(["backend", "infra"]);
    expect(fix("hono-needs-workers")).toEqual(["backend", "infra"]);
    expect(fix("spring-boot-with-d1")).toEqual(["backend", "database"]);
    expect(fix("spring-boot-with-auth")).toEqual(["backend", "auth"]);
    for (const id of [
      "spring-boot-on-workers",
      "hono-needs-workers",
      "spring-boot-with-d1",
      "spring-boot-with-auth",
    ]) {
      expect(rules.find((r) => r.id === id)?.level).toBe("error");
    }
  });
});
