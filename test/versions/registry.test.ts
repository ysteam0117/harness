// 想定する型：test/versions/helpers.ts の冒頭を参照（src/versions/registry.ts の fetchVersionLists）
//   fetchVersionLists(targets, fetchFn, { timeoutMs?, concurrency? }) → Map<名前, { ok: true, versions } | { ok: false, reason }>
//   - npm：https://registry.npmjs.org/<名前>（スコープ付きは "@" 以降をエンコード：@scope%2Fname）を
//     Accept: application/vnd.npm.install-v1+json で取得し、versions の名前の一覧を返す（試験版も含めて、そのまま返す。選ぶのは select.ts）
//   - Node.js：https://nodejs.org/dist/index.json から lts が false でない版だけ。"v" は除く
//   - つながらない・時間切れ・HTTP のエラーは、例外にせず ok: false と理由（パッケージ名でなく、原因の説明）にする
import { describe, expect, it } from "vitest";
import { fetchVersionLists } from "../../src/versions/registry.js";
import { fakeFetch, npmTarget, nodeTarget } from "./helpers.js";

const sorted = (xs: string[]) => [...xs].sort();

describe("#33 AC-1: npm の登録情報の取得", () => {
  it("#33 AC-1: versions の名前の一覧を得る（試験版も、取得の段階では除かない）", async () => {
    const f = fakeFetch({ npm: { "fake-lib": ["1.0.0", "1.1.0", "2.0.0-rc.1", "2.0.0-beta.3"] } });
    const out = await fetchVersionLists([npmTarget("fake-lib")], f.fn);
    const got = out.get("fake-lib");
    expect(got?.ok).toBe(true);
    if (got?.ok)
      expect(sorted(got.versions)).toEqual(
        sorted(["1.0.0", "1.1.0", "2.0.0-rc.1", "2.0.0-beta.3"]),
      );
  });

  it("#33 AC-1: 短い形式（abbreviated metadata）を要求する Accept を付け、URL は registry.npmjs.org/<名前>", async () => {
    const f = fakeFetch({ npm: { "fake-lib": ["1.0.0"] } });
    await fetchVersionLists([npmTarget("fake-lib")], f.fn);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]?.url).toBe("https://registry.npmjs.org/fake-lib");
    expect(f.calls[0]?.accept).toContain("application/vnd.npm.install-v1+json");
  });

  it("#33 AC-1: スコープ付きの名前は、@ 以降の区切りの / をエンコードして要求する", async () => {
    const f = fakeFetch({ npm: { "@fake-scope/lib": ["3.1.0"] } });
    const out = await fetchVersionLists([npmTarget("@fake-scope/lib")], f.fn);
    expect(f.calls[0]?.url).toBe("https://registry.npmjs.org/@fake-scope%2Flib");
    expect(out.get("@fake-scope/lib")?.ok).toBe(true);
  });

  it("#33 AC-1: dist-tags の latest が試験版を指していても、取得の結果には影響しない（versions だけを使う）", async () => {
    const f = fakeFetch({
      npm: { "fake-lib": ["1.0.0", "2.0.0-rc.1"] },
      distTags: { latest: "2.0.0-rc.1", next: "2.0.0-rc.1" },
    });
    const out = await fetchVersionLists([npmTarget("fake-lib")], f.fn);
    const got = out.get("fake-lib");
    expect(got?.ok).toBe(true);
    if (got?.ok) expect(got.versions).toContain("1.0.0");
  });
});

describe("#33 AC-1: Node.js の登録情報の取得", () => {
  it("#33 AC-1: LTS（lts が false でない）の版だけを、先頭の v を除いて得る", async () => {
    const f = fakeFetch({
      node: [
        { version: "v25.1.0", lts: false },
        { version: "v24.19.0", lts: "Krypton" },
        { version: "v24.18.0", lts: "Krypton" },
        { version: "v22.20.0", lts: "Jod" },
        { version: "v23.9.0", lts: false },
      ],
    });
    const out = await fetchVersionLists([nodeTarget()], f.fn);
    expect(f.urls()).toEqual(["https://nodejs.org/dist/index.json"]);
    const got = out.get("node");
    expect(got?.ok).toBe(true);
    if (got?.ok) expect(sorted(got.versions)).toEqual(sorted(["24.19.0", "24.18.0", "22.20.0"]));
  });
});

describe("#33 AC-4: 取得できない場合は、パッケージごとに理由を付けて「取得できない」とする", () => {
  it("#33 AC-4: つながらない（例外）と、HTTP 500、404 は、例外にせず ok: false と理由になる。ほかのパッケージの結果は残る", async () => {
    const f = fakeFetch({
      npm: {
        "down-lib": new Error("connect ECONNREFUSED (fake)"),
        "broken-lib": 500,
        "fine-lib": ["1.2.3"],
      },
    });
    const out = await fetchVersionLists(
      [
        npmTarget("down-lib"),
        npmTarget("broken-lib"),
        npmTarget("missing-lib"),
        npmTarget("fine-lib"),
      ],
      f.fn,
    );
    const down = out.get("down-lib");
    expect(down?.ok).toBe(false);
    if (down && !down.ok) expect(down.reason).toContain("ECONNREFUSED");
    const broken = out.get("broken-lib");
    expect(broken?.ok).toBe(false);
    if (broken && !broken.ok) expect(broken.reason).toContain("500");
    const missing = out.get("missing-lib");
    expect(missing?.ok).toBe(false);
    if (missing && !missing.ok) expect(missing.reason).toContain("404");
    expect(out.get("fine-lib")?.ok).toBe(true);
  });

  it("#33 AC-4: 応答がなく時間切れ（timeoutMs）になると、時間切れの理由で ok: false になる", async () => {
    const f = fakeFetch({ npm: { "slow-lib": "hang" } });
    const out = await fetchVersionLists([npmTarget("slow-lib")], f.fn, { timeoutMs: 30 });
    const got = out.get("slow-lib");
    expect(got?.ok).toBe(false);
    if (got && !got.ok) expect(got.reason).toMatch(/時間切れ|タイムアウト|timeout|abort/i);
  });

  it("#33 AC-4: Node.js の取得の失敗も、理由付きの ok: false になる", async () => {
    const f = fakeFetch({ node: new Error("getaddrinfo ENOTFOUND (fake)") });
    const out = await fetchVersionLists([nodeTarget()], f.fn);
    const got = out.get("node");
    expect(got?.ok).toBe(false);
    if (got && !got.ok) expect(got.reason).toContain("ENOTFOUND");
  });

  it("#33 AC-4: 登録情報の形が想定と違う（versions がない）ときも、もみ消さずに ok: false にする", async () => {
    const odd = (async () =>
      new Response(JSON.stringify({ name: "odd-lib" }), {
        status: 200,
      })) as unknown as typeof fetch;
    const out = await fetchVersionLists([npmTarget("odd-lib")], odd);
    expect(out.get("odd-lib")?.ok).toBe(false);
  });
});

describe("#33 AC-1: 同時に取得する数の上限", () => {
  it("#33 AC-1: 既定では、同時に実行する取得は 6 まで（20 件を取得しても超えない）。全件取得できる", async () => {
    const names = Array.from({ length: 20 }, (_, i) => `fake-lib-${i}`);
    const f = fakeFetch({
      npmFallback: () => ["1.0.0"],
      delayMs: 5,
    });
    const out = await fetchVersionLists(
      names.map((n) => npmTarget(n)),
      f.fn,
    );
    expect(out.size).toBe(20);
    expect(f.calls).toHaveLength(20);
    expect(f.maxInFlight).toBeLessThanOrEqual(6);
    expect(f.maxInFlight).toBeGreaterThan(1); // 直列にはしない
  });

  it("#33 AC-1: concurrency を指定すると、その数を超えない", async () => {
    const names = Array.from({ length: 10 }, (_, i) => `fake-lib-${i}`);
    const f = fakeFetch({ npmFallback: () => ["1.0.0"], delayMs: 5 });
    await fetchVersionLists(
      names.map((n) => npmTarget(n)),
      f.fn,
      { concurrency: 2 },
    );
    expect(f.maxInFlight).toBeLessThanOrEqual(2);
  });
});
