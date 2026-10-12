import { describe, expect, it } from "vitest";
import { fetchVersionLists, mavenMetadataUrl } from "../../src/versions/registry.js";
import type { Target } from "../../src/versions/targets.js";
import { fakeFetch, npmTarget } from "./helpers.js";
import { ADOPTIUM_URL, expectedMavenUrl, fakeMaven, metadataXml } from "./maven-helpers.js";

const mavenTarget = (name: string): Target => ({
  kind: "maven",
  name,
  verified: "1.0.0",
  unverified: false,
  profiles: ["lib/example-jvm"],
});
const javaTarget = (): Target => ({
  kind: "java",
  name: "java",
  verified: "25",
  unverified: false,
  profiles: [],
});

describe("#39 AC-2: Maven Central の取得", () => {
  it("group の . を / にした maven-metadata.xml の URL を取得し、版の一覧を返す", async () => {
    const f = fakeMaven({
      maven: {
        "com.example.sub:demo-lib": metadataXml("com.example.sub", "demo-lib", ["1.0.0", "1.1.0"]),
      },
    });
    const out = await fetchVersionLists([mavenTarget("com.example.sub:demo-lib")], f.fn);
    expect(f.urls()).toEqual([expectedMavenUrl("com.example.sub", "demo-lib")]);
    expect(f.urls()[0]).toBe(
      "https://repo1.maven.org/maven2/com/example/sub/demo-lib/maven-metadata.xml",
    );
    expect(out.get("com.example.sub:demo-lib")).toEqual({ ok: true, versions: ["1.0.0", "1.1.0"] });
  });

  it("404 は ok: false（理由に HTTP 404）", async () => {
    const f = fakeMaven();
    const out = await fetchVersionLists([mavenTarget("com.example:missing-lib")], f.fn);
    const got = out.get("com.example:missing-lib");
    expect(got?.ok).toBe(false);
    if (got && !got.ok) expect(got.reason).toContain("HTTP 404");
  });

  it("時間切れは ok: false（時間切れと示す）", async () => {
    const f = fakeMaven({ maven: { "com.example:slow-lib": "hang" } });
    const out = await fetchVersionLists([mavenTarget("com.example:slow-lib")], f.fn, {
      timeoutMs: 20,
    });
    const got = out.get("com.example:slow-lib");
    expect(got?.ok).toBe(false);
    if (got && !got.ok) expect(got.reason).toContain("時間切れ");
  });

  it("つながらない・XML でない応答は ok: false（例外にしない）", async () => {
    const f = fakeMaven({
      maven: {
        "com.example:down-lib": new Error("ECONNREFUSED (fake)"),
        "com.example:odd-lib": "<html/>",
      },
    });
    const out = await fetchVersionLists(
      [mavenTarget("com.example:down-lib"), mavenTarget("com.example:odd-lib")],
      f.fn,
    );
    expect(out.get("com.example:down-lib")?.ok).toBe(false);
    expect(out.get("com.example:odd-lib")?.ok).toBe(false);
  });

  it("座標の形が誤っているもの（.. や /）は、取得に出ない", async () => {
    const f = fakeMaven();
    for (const bad of [
      "a..b:lib",
      "com.example:..",
      "com/example:lib",
      "com.example:a/b",
      ":lib",
      "nocolon",
    ]) {
      expect(mavenMetadataUrl(bad)).toBeUndefined();
    }
    const out = await fetchVersionLists([mavenTarget("com.example:..")], f.fn);
    expect(out.get("com.example:..")?.ok).toBe(false);
    expect(f.urls()).toEqual([]);
  });

  it("同時に取得する数の上限を守る", async () => {
    const maven: Record<string, string> = {};
    const targets: Target[] = [];
    for (let i = 0; i < 6; i++) {
      maven[`com.example:lib-${String(i)}`] = metadataXml("com.example", `lib-${String(i)}`, [
        "1.0.0",
      ]);
      targets.push(mavenTarget(`com.example:lib-${String(i)}`));
    }
    const f = fakeMaven({ maven, delayMs: 10 });
    await fetchVersionLists(targets, f.fn, { concurrency: 2 });
    expect(f.maxInFlight).toBeLessThanOrEqual(2);
    expect(f.maxInFlight).toBeGreaterThan(0);
  });
});

describe("#39 AC-2: Java の版の取得（Adoptium）", () => {
  it("available_lts_releases を、版の文字列の一覧として返す", async () => {
    const f = fakeMaven({
      java: {
        available_lts_releases: [8, 11, 17, 21, 25],
        available_releases: [8, 11, 17, 21, 25, 26],
      },
    });
    const out = await fetchVersionLists([javaTarget()], f.fn);
    expect(f.urls()).toEqual([ADOPTIUM_URL]);
    expect(out.get("java")).toEqual({ ok: true, versions: ["8", "11", "17", "21", "25"] });
  });

  it("形が想定と違う・HTTP のエラー・つながらないときは ok: false", async () => {
    for (const java of [
      {},
      { available_lts_releases: [] },
      { available_lts_releases: ["x"] },
      503,
    ]) {
      const out = await fetchVersionLists([javaTarget()], fakeMaven({ java }).fn);
      expect(out.get("java")?.ok).toBe(false);
    }
    const down = await fetchVersionLists([javaTarget()], fakeMaven({ java: new Error("fake") }).fn);
    expect(down.get("java")?.ok).toBe(false);
  });
});

describe("#39 AC-2: npm との混在", () => {
  it("npm・Maven・Java が混ざっても、結果は入力の順で返る", async () => {
    const maven = fakeMaven({
      maven: { "com.example:demo-lib": metadataXml("com.example", "demo-lib", ["2.0.0"]) },
      java: { available_lts_releases: [21, 25] },
    });
    const npm = fakeFetch({ npm: { "fake-lib": ["1.0.0"] } });
    const fn = ((input: string | URL | Request, init?: RequestInit) =>
      String(input).startsWith("https://registry.npmjs.org/")
        ? npm.fn(input, init)
        : maven.fn(input, init)) as typeof fetch;
    const targets = [
      npmTarget("fake-lib"),
      mavenTarget("com.example:demo-lib"),
      javaTarget(),
      npmTarget("fake-other"),
    ];
    const out = await fetchVersionLists(targets, fn);
    expect([...out.keys()]).toEqual(["fake-lib", "com.example:demo-lib", "java", "fake-other"]);
    expect(out.get("fake-lib")?.ok).toBe(true);
    expect(out.get("com.example:demo-lib")).toEqual({ ok: true, versions: ["2.0.0"] });
    expect(out.get("java")).toEqual({ ok: true, versions: ["21", "25"] });
    expect(out.get("fake-other")?.ok).toBe(false); // 偽の npm には登録がない（404）
  });
});
