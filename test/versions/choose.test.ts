// 想定する型：test/versions/helpers.ts の冒頭（src/versions/choose.ts の chooseVersions・VersionEntry・VersionResult）を参照
//
// 流れ（F-19・計画のR6）
//   - 方針（policy）にかかわらず、最新の安定版を調べて、調べた日（now）と、そのとき確認した最新の安定版を記録する
//   - policy = verified：すべて検証済みを採用（理由に「検証済み」）。つながらなくても止めず、latestStable は null（未確認）
//     ただし unverified のパッケージは、方針にかかわらず範囲内の最新の安定版（理由に「未検証」）。取得できなければ stopped
//   - policy = latest：
//       対話しない：versions で指定された技術は指定のとおり、指定のない技術は範囲内の最新の安定版
//       対話：表を note で表示 → select "versions_mode"（latest｜verified｜each）→ each なら "version_pick:<名前>"
//   - 取得できないものが1つでもある（policy = latest、または unverified がある）：
//       取得できない名前と理由を note か message に示す。対話しない：versionsOffline = "verified" なら検証済みで進める、なければ stopped
//       対話：confirm "versions_offline_confirm"。いいえなら stopped、はいなら検証済みで進める
//   - 範囲に合う安定版がなければ、検証済みを使い、理由に「範囲」を書く
//   - 大きな版（メジャー）が違う版を採用する場合は、note に、パッケージ名と「ハーネスで動作を確認していない」旨の警告を出す
//   - keep：既に選んだ結果。対象にある名前は調べ直さずそのまま入れ、対象にない名前は結果から除く
import { describe, expect, it } from "vitest";
import {
  chooseVersions,
  type ChooseOptions,
  type VersionEntry,
} from "../../src/versions/choose.js";
import { FakePrompter } from "../questions/helpers.js";
import {
  FIXED_DAY,
  FIXED_NOW,
  fakeFetch,
  nodeTarget,
  npmTarget,
  type FakeFetchSpec,
} from "./helpers.js";

const NODE_INDEX = [
  { version: "v25.1.0", lts: false as const },
  { version: "v24.20.0", lts: "Krypton" },
  { version: "v24.19.0", lts: "Krypton" },
];

const SPEC: FakeFetchSpec = {
  npm: {
    "fake-lib": ["1.2.0", "1.3.0", "2.0.0-rc.1"],
    "fake-ranged": ["3.9.0", "4.1.0", "4.2.0", "5.0.0", "5.1.0-beta.1"],
    "fake-major": ["1.0.0", "2.0.0"],
  },
  node: NODE_INDEX,
};

function setup(
  over: Partial<ChooseOptions> = {},
  spec: FakeFetchSpec = SPEC,
  script: Record<string, unknown[]> = {},
) {
  const prompter = new FakePrompter(script);
  const f = fakeFetch(spec);
  const opts: ChooseOptions = {
    targets: [
      nodeTarget("24.19.0"),
      npmTarget("fake-lib", { verified: "1.2.0" }),
      npmTarget("fake-ranged", { verified: "4.1.0", range: "^4" }),
    ],
    policy: "latest",
    interactive: false,
    prompter,
    fetch: f.fn,
    now: FIXED_NOW,
    ...over,
  };
  return { prompter, f, opts, run: () => chooseVersions(opts) };
}

async function ok(run: () => ReturnType<typeof chooseVersions>) {
  const out = await run();
  if (out.status !== "ok") throw new Error(`成功のはずが stopped：${out.message}`);
  return out.result;
}
const entry = (r: { entries: VersionEntry[] }, name: string) => {
  const e = r.entries.find((x) => x.name === name);
  if (!e) throw new Error(`${name} の結果がありません`);
  return e;
};

describe("#33 AC-1・AC-2: 範囲内の最新の安定版を採用する（方針 latest・対話しない）", () => {
  it("#33 AC-1: 試験版を除いた最新を採用する。理由・調べた日・最新の安定版・検証済みを記録する", async () => {
    const s = setup();
    const r = await ok(s.run);
    const lib = entry(r, "fake-lib");
    expect(lib).toMatchObject({
      version: "1.3.0",
      surveyedOn: FIXED_DAY,
      latestStable: "1.3.0",
      verified: "1.2.0",
      newerThanVerified: true,
      majorDiffers: false,
    });
    expect(lib.reason).toContain("最新の安定版");
    expect(s.prompter.inputs).toHaveLength(0); // 対話しないので、入力は使わない
  });

  it("#33 AC-2: 範囲（^4）の中の最大を採用する。5 系・試験版があっても選ばない。理由に範囲を示す", async () => {
    const r = await ok(setup().run);
    const e = entry(r, "fake-ranged");
    expect(e.version).toBe("4.2.0");
    expect(e.latestStable).toBe("4.2.0");
    expect(e.reason).toContain("^4");
  });

  it("#33 AC-2: Node.js は、LTS の中の最大を採用する（LTS でない 25 系は選ばない）", async () => {
    const r = await ok(setup().run);
    const node = entry(r, "node");
    expect(node.version).toBe("24.20.0");
    expect(node.verified).toBe("24.19.0");
    expect(node.latestStable).toBe("24.20.0");
  });

  it("#33 AC-2: 範囲に合う安定版がなければ、検証済みを採用し、理由に範囲を示す", async () => {
    const s = setup(
      {},
      { ...SPEC, npm: { ...SPEC.npm, "fake-ranged": ["5.0.0", "5.1.0", "4.2.0-rc.1"] } },
    );
    const e = entry(await ok(s.run), "fake-ranged");
    expect(e.version).toBe("4.1.0");
    expect(e.reason).toMatch(/範囲/);
    expect(e.newerThanVerified).toBe(false);
  });

  it("#33 AC-2: 結果の並びは、対象の並びと同じ", async () => {
    const r = await ok(setup().run);
    expect(r.entries.map((e) => e.name)).toEqual(["node", "fake-lib", "fake-ranged"]);
  });
});

describe("#33 AC-3: 検証済みと大きな版が違うと警告する", () => {
  const majorTargets = [npmTarget("fake-major", { verified: "1.0.0" })];

  it("#33 AC-3: 大きな版が違う版を採用すると、パッケージ名と「ハーネスで動作を確認していない」警告を表示し、majorDiffers が真", async () => {
    const s = setup({ targets: majorTargets });
    const r = await ok(s.run);
    const e = entry(r, "fake-major");
    expect(e).toMatchObject({ version: "2.0.0", newerThanVerified: true, majorDiffers: true });
    const shown = s.prompter.notes.join("\n");
    expect(shown).toContain("fake-major");
    expect(shown).toMatch(/ハーネスで動作を確認して(いない|いません)/);
    expect(r.newerThanVerified).toBe(true);
  });

  it("#33 AC-3: 小さな版の違いだけなら、警告の文は出ない（ただし newerThanVerified は真。ルール7の事実）", async () => {
    const s = setup({ targets: [npmTarget("fake-lib", { verified: "1.2.0" })] });
    const r = await ok(s.run);
    expect(entry(r, "fake-lib").majorDiffers).toBe(false);
    expect(r.newerThanVerified).toBe(true);
    expect(s.prompter.notes.join("\n")).not.toMatch(/ハーネスで動作を確認して(いない|いません)/);
  });

  it("#33 AC-3: 検証済みと同じ版を採用するなら、newerThanVerified は偽", async () => {
    const s = setup({ policy: "verified" });
    const r = await ok(s.run);
    expect(r.newerThanVerified).toBe(false);
    expect(r.entries.every((e) => !e.newerThanVerified && !e.majorDiffers)).toBe(true);
  });

  it("#33 AC-3: 表（検証済み｜最新の安定版｜比較）を表示する。パッケージ名と両方の版が出る", async () => {
    const s = setup();
    await ok(s.run);
    const shown = s.prompter.notes.join("\n");
    for (const name of ["node", "fake-lib", "fake-ranged"]) expect(shown).toContain(name);
    expect(shown).toContain("1.2.0"); // 検証済み
    expect(shown).toContain("1.3.0"); // 最新の安定版
    expect(shown).toContain("4.2.0");
  });
});

describe("#33 R6: 方針 verified でも調べて記録する。つながらなくても止めない", () => {
  it("#33 R6: すべて検証済みを採用（理由に「検証済み」）。調べた日と最新の安定版も記録し、fetch は呼ばれる", async () => {
    const s = setup({ policy: "verified" });
    const r = await ok(s.run);
    expect(s.f.calls.length).toBeGreaterThan(0);
    const lib = entry(r, "fake-lib");
    expect(lib.version).toBe("1.2.0");
    expect(lib.reason).toContain("検証済み");
    expect(lib.latestStable).toBe("1.3.0"); // そのとき確認した最新の安定版
    expect(lib.surveyedOn).toBe(FIXED_DAY);
    expect(entry(r, "node").version).toBe("24.19.0");
    expect(s.prompter.inputs).toHaveLength(0);
  });

  it("#33 R6: 対話でも、方針 verified なら何も聞かない（表示だけ）", async () => {
    const s = setup({ policy: "verified", interactive: true });
    await ok(s.run);
    expect(s.prompter.inputs).toHaveLength(0);
  });

  it("#33 R6: すべての取得が失敗しても、確認なしで検証済みのまま進む。最新の安定版は null（未確認）", async () => {
    const s = setup(
      { policy: "verified", interactive: true },
      { npmFallback: () => undefined, node: new Error("getaddrinfo ENOTFOUND (fake)") },
    );
    const r = await ok(s.run);
    expect(s.prompter.inputs).toHaveLength(0);
    for (const e of r.entries) {
      expect(e.version).toBe(e.verified);
      expect(e.latestStable).toBeNull();
      expect(e.surveyedOn).toBe(FIXED_DAY);
    }
    expect(r.newerThanVerified).toBe(false);
  });
});

describe("#33 AC-4: ネットワークにつながらない場合（方針 latest）", () => {
  const failing: FakeFetchSpec = {
    npm: {
      "fake-lib": new Error("connect ECONNREFUSED (fake)"),
      "fake-ranged": ["4.1.0", "4.2.0"],
    },
    node: NODE_INDEX,
  };

  it("#33 AC-4: 対話しない・versionsOffline なし：取得できないパッケージと理由を示して stopped（入力は使わない）", async () => {
    const s = setup({}, failing);
    const out = await s.run();
    expect(out.status).toBe("stopped");
    if (out.status === "stopped") {
      expect(out.message).toContain("fake-lib");
      expect(out.message).toContain("ECONNREFUSED");
      expect(out.message).toContain("versions_offline"); // 進める方法を案内する
    }
    expect(s.prompter.inputs).toHaveLength(0);
  });

  it("#33 AC-4: 対話しない・versionsOffline: verified：検証済みで進める（取得できないパッケージは検証済みを採用）", async () => {
    const s = setup({ versionsOffline: "verified" }, failing);
    const r = await ok(s.run);
    const lib = entry(r, "fake-lib");
    expect(lib.version).toBe("1.2.0");
    expect(lib.reason).toContain("検証済み");
    expect(lib.latestStable).toBeNull();
    expect(s.prompter.inputs).toHaveLength(0);
  });

  it("#33 AC-4: 対話：パッケージと理由を表示し、「検証済みのバージョンで進めますか」を確かめる。いいえなら stopped", async () => {
    const s = setup({ interactive: true }, failing, { versions_offline_confirm: [false] });
    const out = await s.run();
    expect(out.status).toBe("stopped");
    expect(s.prompter.askedIds).toEqual(["versions_offline_confirm"]);
    const confirm = s.prompter.inputs[0];
    expect(confirm?.method).toBe("confirm");
    expect(confirm?.message).toContain("検証済み");
    // 確認の前に、取得できない理由が表示されている
    const at = s.prompter.events.findIndex((e) => e.type === "input");
    const before = s.prompter.events
      .slice(0, at)
      .filter((e) => e.type === "note")
      .map((e) => e.message)
      .join("\n");
    expect(before).toContain("fake-lib");
    expect(before).toContain("ECONNREFUSED");
  });

  it("#33 AC-4: 対話：はいなら、検証済みで最後まで進む（技術ごとの選択などは聞かない）", async () => {
    const s = setup({ interactive: true }, failing, { versions_offline_confirm: [true] });
    const r = await ok(s.run);
    expect(s.prompter.askedIds).toEqual(["versions_offline_confirm"]);
    expect(entry(r, "fake-lib").version).toBe("1.2.0");
  });

  it("#33 AC-4: HTTP 500・時間切れでも同じ（理由に 500・時間切れの旨が出る）", async () => {
    const s500 = setup(
      {},
      { npm: { "fake-lib": 500, "fake-ranged": ["4.2.0"] }, node: NODE_INDEX },
    );
    const out500 = await s500.run();
    expect(out500.status).toBe("stopped");
    if (out500.status === "stopped") expect(out500.message).toContain("500");

    const sHang = setup(
      { timeoutMs: 30 },
      { npm: { "fake-lib": "hang", "fake-ranged": ["4.2.0"] }, node: NODE_INDEX },
    );
    const outHang = await sHang.run();
    expect(outHang.status).toBe("stopped");
    if (outHang.status === "stopped") {
      expect(outHang.message).toContain("fake-lib");
      expect(outHang.message).toMatch(/時間切れ|タイムアウト|timeout|abort/i);
    }
  });
});

describe("#33 選択：利用者が決める", () => {
  it("#33 選択：すべて最新の安定版（versions_mode = latest）", async () => {
    const s = setup({ interactive: true }, SPEC, { versions_mode: ["latest"] });
    const r = await ok(s.run);
    expect(s.prompter.askedIds).toEqual(["versions_mode"]);
    expect(s.prompter.inputs[0]?.method).toBe("select");
    expect(entry(r, "fake-lib").version).toBe("1.3.0");
    expect(entry(r, "fake-ranged").version).toBe("4.2.0");
    expect(entry(r, "node").version).toBe("24.20.0");
  });

  it("#33 選択：すべて検証済み（versions_mode = verified）。最新の安定版の記録は残る", async () => {
    const s = setup({ interactive: true }, SPEC, { versions_mode: ["verified"] });
    const r = await ok(s.run);
    expect(entry(r, "fake-lib").version).toBe("1.2.0");
    expect(entry(r, "fake-lib").latestStable).toBe("1.3.0");
    expect(entry(r, "fake-ranged").version).toBe("4.1.0");
    expect(entry(r, "node").version).toBe("24.19.0");
    expect(r.newerThanVerified).toBe(false);
  });

  it("#33 選択：技術ごとに選ぶ（each）。パッケージごとに version_pick:<名前> を聞く（Node.js を含む）", async () => {
    const s = setup({ interactive: true }, SPEC, {
      versions_mode: ["each"],
      "version_pick:node": ["verified"],
      "version_pick:fake-lib": ["latest"],
      "version_pick:fake-ranged": ["verified"],
    });
    const r = await ok(s.run);
    expect(s.prompter.askedIds).toEqual([
      "versions_mode",
      "version_pick:node",
      "version_pick:fake-lib",
      "version_pick:fake-ranged",
    ]);
    expect(entry(r, "node").version).toBe("24.19.0");
    expect(entry(r, "fake-lib").version).toBe("1.3.0");
    expect(entry(r, "fake-ranged").version).toBe("4.1.0");
    expect(r.newerThanVerified).toBe(true); // 1つでも検証済みより新しい版を採用した
  });

  it("#33 選択：表は、選ぶより前に表示される", async () => {
    const s = setup({ interactive: true }, SPEC, { versions_mode: ["latest"] });
    await ok(s.run);
    const firstInput = s.prompter.events.findIndex((e) => e.type === "input");
    const tableAt = s.prompter.events.findIndex(
      (e) => e.type === "note" && e.message.includes("fake-ranged"),
    );
    expect(tableAt).toBeGreaterThanOrEqual(0);
    expect(tableAt).toBeLessThan(firstInput);
  });

  it("#33 選択：--answers の versions で、技術ごとの選択を渡せる（指定のない技術は範囲内の最新の安定版）", async () => {
    const s = setup({ versions: { "fake-lib": "verified", node: "latest" } });
    const r = await ok(s.run);
    expect(entry(r, "fake-lib").version).toBe("1.2.0"); // 指定どおり検証済み
    expect(entry(r, "fake-ranged").version).toBe("4.2.0"); // 指定なし → 最新の安定版
    expect(entry(r, "node").version).toBe("24.20.0");
    expect(s.prompter.inputs).toHaveLength(0);
  });
});

describe("#33 R1: unverified のパッケージ（検証済みのないもの）", () => {
  const unverifiedTarget = npmTarget("fake-new", { unverified: true, range: "^14" });
  const spec: FakeFetchSpec = {
    npm: {
      "fake-new": ["13.5.0", "14.1.0", "14.2.0", "15.0.0", "14.3.0-rc.1"],
      "fake-lib": ["1.2.0"],
    },
    node: NODE_INDEX,
  };

  it("#33 R1: 方針 verified でも、範囲内の最新の安定版を採用し、理由は「ハーネスで未検証」。検証済みは null", async () => {
    const s = setup(
      { policy: "verified", targets: [npmTarget("fake-lib"), unverifiedTarget] },
      spec,
    );
    const r = await ok(s.run);
    const e = entry(r, "fake-new");
    expect(e.version).toBe("14.2.0");
    expect(e.reason).toContain("ハーネスで未検証");
    expect(e.verified).toBeNull();
    expect(e.latestStable).toBe("14.2.0");
    expect(entry(r, "fake-lib").version).toBe("1.0.0");
  });

  it("#33 R1: 確認の表示（note）に、未検証であることの警告とパッケージ名が出る", async () => {
    const s = setup({ policy: "verified", targets: [unverifiedTarget] }, spec);
    await ok(s.run);
    const shown = s.prompter.notes.join("\n");
    expect(shown).toContain("fake-new");
    expect(shown).toContain("未検証");
  });

  it("#33 R1: 取得できないときは、理由を示して stopped（戻せる版がないため）。versionsOffline があっても、対話で確認を聞くこともしない", async () => {
    const down: FakeFetchSpec = {
      npm: { "fake-new": new Error("connect ECONNREFUSED (fake)") },
      node: NODE_INDEX,
    };
    for (const interactive of [false, true]) {
      const s = setup(
        {
          policy: "verified",
          interactive,
          versionsOffline: "verified",
          targets: [unverifiedTarget],
        },
        down,
      );
      const out = await s.run();
      expect(out.status).toBe("stopped");
      if (out.status === "stopped") {
        expect(out.message).toContain("fake-new");
        expect(out.message).toContain("ECONNREFUSED");
      }
      expect(s.prompter.inputs).toHaveLength(0);
    }
  });

  it("#33 R1: 方針 latest で技術ごとに verified を選ぼうとしても、unverified のパッケージは最新の安定版のまま（選択肢を聞かない）", async () => {
    const s = setup(
      { policy: "latest", interactive: true, targets: [npmTarget("fake-lib"), unverifiedTarget] },
      spec,
      {
        versions_mode: ["verified"],
      },
    );
    const r = await ok(s.run);
    expect(entry(r, "fake-new").version).toBe("14.2.0");
    expect(entry(r, "fake-lib").version).toBe("1.0.0");
  });
});

describe("#33 R3: 既に選んだものは調べ直さない（keep）", () => {
  const kept: VersionEntry = {
    name: "fake-lib",
    version: "1.2.0",
    reason: "利用者が検証済みを選択",
    surveyedOn: "2026-10-01",
    latestStable: "1.3.0",
    latestStatus: "found",
    verified: "1.2.0",
    newerThanVerified: false,
    majorDiffers: false,
  };
  const gone: VersionEntry = { ...kept, name: "gone-lib", verified: "9.0.0", version: "9.0.0" };

  it("#33 R3: keep にある名前は取得せず、そのまま結果に入る。増えた対象だけを取得して選ぶ", async () => {
    const s = setup({ keep: [kept], policy: "latest" });
    const r = await ok(s.run);
    expect(s.f.npmNames()).not.toContain("fake-lib");
    expect(s.f.npmNames()).toContain("fake-ranged");
    expect(entry(r, "fake-lib")).toEqual(kept);
    expect(entry(r, "fake-ranged").version).toBe("4.2.0");
  });

  it("#33 R3: 対象から減った名前（keep にあって、対象にない）は、結果から除く。事実は結果から計算し直す", async () => {
    const s = setup({ keep: [kept, gone], policy: "latest" });
    const r = await ok(s.run);
    expect(r.entries.map((e) => e.name)).not.toContain("gone-lib");
    expect(r.newerThanVerified).toBe(r.entries.some((e) => e.newerThanVerified));
  });

  it("#33 R3: keep の結果が検証済みより新しい版なら、newerThanVerified は真のまま（取得し直さなくても計算に入る）", async () => {
    const newer: VersionEntry = { ...kept, version: "1.3.0", newerThanVerified: true };
    const s = setup({ keep: [newer], policy: "verified" });
    const r = await ok(s.run);
    expect(r.newerThanVerified).toBe(true);
    expect(entry(r, "fake-lib").version).toBe("1.3.0");
  });
});

describe("#33 レビュー指摘2：versions で verified を指定したパッケージの取得が失敗しても、理由を表示して残す", () => {
  it("#33 レビュー指摘2：方針 latest・versions: { fake-lib: verified }・fake-lib の取得が失敗：検証済みを採用し、理由（ECONNREFUSED）を note に表示し、結果にも残す", async () => {
    const s = setup(
      { versions: { "fake-lib": "verified" } },
      {
        npm: {
          "fake-lib": new Error("connect ECONNREFUSED (fake)"),
          "fake-ranged": ["4.1.0", "4.2.0"],
        },
        node: NODE_INDEX,
      },
    );
    const r = await ok(s.run);
    const lib = entry(r, "fake-lib");
    expect(lib.version).toBe("1.2.0");
    expect(lib.latestStable).toBeNull();
    expect(lib.latestStatus).toBe("failed");
    expect(lib.fetchFailure).toContain("ECONNREFUSED");
    expect(s.prompter.notes.join("\n")).toContain("ECONNREFUSED");
    expect(s.prompter.inputs).toHaveLength(0);
  });

  it("#33 レビュー指摘2：方針 verified で取得が失敗した場合も、理由が結果（fetchFailure）に残る", async () => {
    const s = setup(
      { policy: "verified" },
      { npm: { "fake-lib": 500, "fake-ranged": ["4.2.0"] }, node: NODE_INDEX },
    );
    const r = await ok(s.run);
    expect(entry(r, "fake-lib").latestStatus).toBe("failed");
    expect(entry(r, "fake-lib").fetchFailure).toContain("500");
    expect(entry(r, "fake-ranged").fetchFailure).toBeUndefined();
  });
});

describe("#33 レビュー指摘3：latestStatus（found・none_in_range・failed）", () => {
  it("#33 レビュー指摘3：取得でき、範囲内の安定版がある → found", async () => {
    const r = await ok(setup().run);
    expect(entry(r, "fake-ranged").latestStatus).toBe("found");
    expect(entry(r, "fake-ranged").fetchFailure).toBeUndefined();
  });

  it("#33 レビュー指摘3：取得できたが、範囲 ^4 に合う安定版がない（5.0.0 だけ）→ none_in_range（失敗の理由はなし）。検証済みを採用", async () => {
    const s = setup({}, { ...SPEC, npm: { ...SPEC.npm, "fake-ranged": ["5.0.0", "5.1.0"] } });
    const e = entry(await ok(s.run), "fake-ranged");
    expect(e.latestStatus).toBe("none_in_range");
    expect(e.latestStable).toBeNull();
    expect(e.fetchFailure).toBeUndefined();
    expect(e.version).toBe("4.1.0");
  });

  it("#33 レビュー指摘3：方針 verified でも、範囲に合う安定版がなければ none_in_range", async () => {
    const s = setup(
      { policy: "verified" },
      { ...SPEC, npm: { ...SPEC.npm, "fake-ranged": ["5.0.0"] } },
    );
    expect(entry(await ok(s.run), "fake-ranged").latestStatus).toBe("none_in_range");
  });

  it("#33 レビュー指摘3：取得に失敗 → failed（none_in_range と区別される）", async () => {
    const s = setup(
      { policy: "verified" },
      {
        npm: { "fake-lib": new Error("ECONNREFUSED (fake)"), "fake-ranged": ["4.2.0"] },
        node: NODE_INDEX,
      },
    );
    const r = await ok(s.run);
    expect(entry(r, "fake-lib").latestStatus).toBe("failed");
    expect(entry(r, "fake-lib").fetchFailure).toContain("ECONNREFUSED");
  });
});

describe("#33 レビュー指摘4：調べた日は、利用者のPCのローカルの日付", () => {
  it.each([
    ["ローカルの 0 時 30 分", new Date(2026, 9, 3, 0, 30), "2026-10-03"],
    ["ローカルの 23 時 30 分", new Date(2026, 9, 3, 23, 30), "2026-10-03"],
    ["ローカルの年末の 0 時 30 分", new Date(2026, 11, 31, 0, 30), "2026-12-31"],
  ])(
    "#33 レビュー指摘4：%s は、UTC の日付に引きずられずローカルの日付になる",
    async (_label, now, day) => {
      const s = setup({ now, policy: "verified" });
      const r = await ok(s.run);
      expect(r.entries.every((e) => e.surveyedOn === day)).toBe(true);
    },
  );
});
