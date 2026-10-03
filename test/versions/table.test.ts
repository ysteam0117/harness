// #33 バージョンの表示：列をそろえた表（利用者の動作確認で、折り返されて見づらいと分かった。「全部を列をそろえた表にする」）
//
// 想定する形は test/versions/helpers.ts の「列をそろえた表（note）の検査の道具」の前のコメントを参照
//   - chooseVersions の note「バージョンの調査結果」：見出し行（パッケージ・検証済み・最新・差・範囲）＋パッケージごとに1行。
//     表が終わったら空行を1つ入れ、その下に警告・取得できない理由を別の行で出す（既存の文言は残す）
//   - create の note「採用するバージョン」：見出し行（パッケージ・採用・理由）＋パッケージごとに1行
//   - 列の開始位置は、表示の幅（全角 2・半角 1）でそろえる。表の各行は表示の幅 80 以下
//   - パッケージ名が長すぎて入らない行だけは、省略せず、その行だけ次の列を詰めてよい（内容は欠けさせない）
import { writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import type { ToolStatus } from "../../src/checks/tools.js";
import { runCreate, type CreateDeps } from "../../src/commands/create.js";
import { chooseVersions, type ChooseOptions } from "../../src/versions/choose.js";
import { FakePrompter, baseAnswers, cleanupTmp, makeTmp } from "../questions/helpers.js";
import {
  FIXED_NOW,
  alignmentProblems,
  cellsAt,
  columnStarts,
  displayWidth,
  fakeFetch,
  nodeTarget,
  npmTarget,
  offlineFetch,
  registryForReal,
  tableLines,
  type FakeFetchSpec,
} from "./helpers.js";

afterEach(cleanupTmp);

const SURVEY = "バージョンの調査結果";
const ADOPTED = "採用するバージョン";
const LONG = "@cloudflare/vitest-pool-workers";

const SPEC: FakeFetchSpec = {
  npm: {
    "fake-same": ["1.0.0", "1.0.0-rc.1"],
    "fake-lib": ["1.2.0", "1.3.0"],
    "fake-major": ["1.0.0", "2.0.0"],
    "fake-ranged": ["5.0.0", "5.1.0"],
    "fake-ok-ranged": ["4.1.0", "4.2.0", "5.0.0"],
    [LONG]: ["0.22.0", "0.22.1"],
    "fake-down": new Error("connect ECONNREFUSED (fake)"),
  },
  node: [
    { version: "v24.19.0", lts: "Krypton" },
    { version: "v25.1.0", lts: false },
  ],
};

const targets = () => [
  nodeTarget("24.19.0"),
  npmTarget("fake-same", { verified: "1.0.0" }),
  npmTarget("fake-lib", { verified: "1.2.0" }),
  npmTarget("fake-major", { verified: "1.0.0" }),
  npmTarget("fake-ranged", { verified: "4.1.0", range: "^4" }),
  npmTarget("fake-ok-ranged", { verified: "4.1.0", range: ">=4.0.0 <5.0.0" }),
  npmTarget(LONG, { verified: "0.22.0", range: "^0.22.0" }),
  npmTarget("fake-down", { verified: "1.0.0" }),
];

async function run(over: Partial<ChooseOptions> = {}, spec: FakeFetchSpec = SPEC) {
  const prompter = new FakePrompter();
  const f = fakeFetch(spec);
  const out = await chooseVersions({
    targets: targets(),
    policy: "verified",
    interactive: false,
    prompter,
    fetch: f.fn,
    now: FIXED_NOW,
    ...over,
  });
  if (out.status !== "ok") throw new Error(`stopped：${out.message}`);
  return { prompter, notes: prompter.notes };
}

const HEADER_WORDS = ["パッケージ", "検証済み", "最新", "差", "使える範囲"];

describe("#33 表示：「バージョンの調査結果」を、列をそろえた表にする", () => {
  it("#33 表示：見出しの行（パッケージ・検証済み・最新・差・範囲の順）がある", async () => {
    const { notes } = await run();
    const { header } = tableLines(notes, SURVEY);
    const starts = columnStarts(header);
    expect(starts).toHaveLength(5);
    expect(cellsAt(header, starts)).toEqual(HEADER_WORDS);
    expect(starts[0]).toBe(0);
  });

  it("#33 表示：すべてのパッケージ（Node.js を含む）の行があり、1 パッケージにつき 1 行", async () => {
    const { notes } = await run();
    const { header, rows } = tableLines(notes, SURVEY);
    const starts = columnStarts(header);
    const first = rows.map((r) => cellsAt(r, starts)[0] ?? "");
    expect(rows).toHaveLength(targets().length);
    for (const t of targets()) {
      const hits = first.filter((c) => (t.name === "node" ? c.startsWith("node") : c === t.name));
      expect(hits, t.name).toHaveLength(1);
    }
  });

  it("#33 表示：各行の列の開始位置が、見出しとそろっている（長い @cloudflare/vitest-pool-workers を含む）", async () => {
    const { notes } = await run();
    const { header, rows } = tableLines(notes, SURVEY);
    expect(rows.some((r) => r.startsWith(LONG))).toBe(true);
    expect(alignmentProblems(rows, columnStarts(header))).toEqual([]);
  });

  it("#33 表示：どの行も表示の幅が 80 以下（折り返されない）", async () => {
    const { notes } = await run();
    const { header, rows } = tableLines(notes, SURVEY);
    for (const line of [header, ...rows]) {
      expect(displayWidth(line), line).toBeLessThanOrEqual(80);
    }
  });

  it("#33 表示：差の列は「同じ」・「小」・「大」・「未確認」・「範囲外」。範囲の列は Target.range（なければ空）", async () => {
    const { notes } = await run();
    const { header, rows } = tableLines(notes, SURVEY);
    const starts = columnStarts(header);
    const by = (name: string) => {
      const row = rows.find((r) => cellsAt(r, starts)[0] === name);
      if (!row) throw new Error(`${name} の行がありません`);
      return cellsAt(row, starts);
    };
    expect(by("fake-same")[3]).toBe("同じ");
    expect(by("fake-same")[4]).toBe("");
    expect(by("fake-lib")[3]).toBe("小");
    expect(by("fake-major")[3]).toBe("大");
    expect(by("fake-down")[3]).toBe("未確認");
    expect(by("fake-ranged")[3]).toBe("範囲外");
    expect(by("fake-ranged")[4]).toBe("^4");
    expect(by("fake-ok-ranged")[4]).toBe(">=4.0.0 <5.0.0");
    expect(by("fake-ok-ranged")[3]).toBe("小");
    // 検証済み・最新の列には版が入る
    expect(by("fake-lib")[1]).toBe("1.2.0");
    expect(by("fake-lib")[2]).toBe("1.3.0");
    expect(by(LONG)[1]).toBe("0.22.0");
    expect(by(LONG)[2]).toBe("0.22.1");
    const node = rows.find((r) => cellsAt(r, starts)[0]?.startsWith("node"));
    expect(cellsAt(node ?? "", starts)[1]).toBe("24.19.0");
  });

  it("#33 表示：警告・取得できない理由は、表の下に別の行で出す（表の行には入れない。既存の文言は残る）", async () => {
    // 方針 latest（大きな版が違う fake-major を採用する）。fake-down は検証済みを指定（取得できない理由は残る）
    const { notes } = await run({ policy: "latest", versions: { "fake-down": "verified" } });
    const { header, rows, rest } = tableLines(notes, SURVEY);
    for (const line of [header, ...rows]) {
      expect(line).not.toContain("ECONNREFUSED");
      expect(line).not.toMatch(/ハーネスで動作を確認/);
    }
    // 表の下（または別の note）に、取得できない理由と、大きな版の警告がある
    const below = [...rest, ...notes.filter((n) => !n.startsWith(`${SURVEY}\n`))].join("\n");
    expect(below).toContain("fake-down");
    expect(below).toContain("ECONNREFUSED");
    expect(below).toContain("fake-major");
    expect(below).toMatch(/ハーネスで動作を確認して(いない|いません)/);
  });

  it("#33 表示：パッケージ名が長すぎる場合は、省略せず（名前も版も欠けさせず）、その行だけ次の列を詰めてよい。ほかの行はそろったまま", async () => {
    const longName = `@fake-scope/${"a".repeat(70)}`;
    const spec: FakeFetchSpec = { ...SPEC, npm: { ...SPEC.npm, [longName]: ["3.4.0", "3.5.0"] } };
    const { notes } = await run(
      { targets: [...targets(), npmTarget(longName, { verified: "3.4.0" })] },
      spec,
    );
    const { header, rows } = tableLines(notes, SURVEY);
    const row = rows.find((r) => r.includes(longName));
    expect(row).toBeDefined();
    expect(row).not.toContain("…");
    expect(row).toContain("3.4.0");
    expect(row).toContain("3.5.0");
    expect(row).toMatch(/小/);
    const others = rows.filter((r) => !r.includes(longName));
    expect(alignmentProblems(others, columnStarts(header))).toEqual([]);
    for (const line of others) expect(displayWidth(line)).toBeLessThanOrEqual(80);
  });
});

// ---------------------------------------------------------------------------
// create：確認の一覧「採用するバージョン」
// ---------------------------------------------------------------------------

const okTools = async (): Promise<ToolStatus[]> => [
  { name: "node", state: "ok", version: "24.0.0" },
  { name: "git", state: "ok", version: "2.45.0" },
  { name: "docker", state: "ok", version: "27.0.1" },
];

async function createWith(
  fetcher: ReturnType<typeof fakeFetch>,
  over: Record<string, unknown> = {},
) {
  const tmp = makeTmp();
  const prompter = new FakePrompter();
  const deps = {
    prompter,
    cwd: tmp.cwd,
    interactive: false,
    stderr: () => undefined,
    checkTools: okTools,
    fetch: fetcher.fn,
    now: () => FIXED_NOW,
  } as CreateDeps;
  const file = path.join(tmp.inputDir, "answers.yaml");
  writeFileSync(file, stringify({ ...baseAnswers(), ...over }));
  const out = await runCreate({ answers: file, yes: true }, deps);
  return { out, notes: prompter.notes };
}

describe("#33 表示：確認の一覧「採用するバージョン」を、列をそろえた表にする（実際のプロファイル）", () => {
  it("#33 表示：見出し（パッケージ・採用・理由）と、すべてのパッケージの行がある", async () => {
    const { out, notes } = await createWith(registryForReal());
    const { header, rows } = tableLines(notes, ADOPTED);
    const starts = columnStarts(header);
    expect(cellsAt(header, starts)).toEqual(["パッケージ", "採用", "理由"]);
    const entries = out.versions?.entries ?? [];
    expect(entries.length).toBeGreaterThan(10);
    expect(rows).toHaveLength(entries.length);
    for (const e of entries) {
      const row = rows.find((r) => {
        const c = cellsAt(r, starts)[0] ?? "";
        return e.name === "node" ? c.startsWith("node") : c === e.name;
      });
      expect(row, e.name).toBeDefined();
      expect(cellsAt(row ?? "", starts)[1], e.name).toBe(e.version);
    }
  });

  it("#33 表示：列がそろっていて（@cloudflare/vitest-pool-workers を含む）、どの行も表示の幅 80 以下。理由は短い言葉（検証済み など）", async () => {
    const { notes } = await createWith(registryForReal());
    const { header, rows } = tableLines(notes, ADOPTED);
    const starts = columnStarts(header);
    expect(rows.some((r) => r.startsWith(LONG))).toBe(true);
    expect(alignmentProblems(rows, starts)).toEqual([]);
    for (const line of [header, ...rows]) expect(displayWidth(line), line).toBeLessThanOrEqual(80);
    for (const r of rows) {
      const reason = cellsAt(r, starts)[2] ?? "";
      expect(reason).not.toBe("");
      expect(displayWidth(reason), r).toBeLessThanOrEqual(24); // 長い文章（取得の経緯など）は入れない
      expect(reason).toContain("検証済み"); // 方針 verified の既定
    }
  });

  it("#33 表示：方針 latest で新しい版を採用した行の理由は「最新」を含む短い言葉", async () => {
    const { notes } = await createWith(registryForReal({ axios: ["1.20.0", "1.21.0"] }), {
      version_policy: "latest",
      accepted_warnings: ["version-newer-than-verified"],
    });
    const { header, rows } = tableLines(notes, ADOPTED);
    const starts = columnStarts(header);
    const axios = rows.find((r) => cellsAt(r, starts)[0] === "axios");
    expect(cellsAt(axios ?? "", starts)[1]).toBe("1.21.0");
    expect(cellsAt(axios ?? "", starts)[2]).toContain("最新");
    expect(displayWidth(cellsAt(axios ?? "", starts)[2] ?? "")).toBeLessThanOrEqual(24);
  });

  it("#33 表示：取得に失敗した場合の調査結果の表でも、差は「未確認」で、列はそろい、幅 80 以下（実際のプロファイル）", async () => {
    const { notes } = await createWith(offlineFetch());
    const { header, rows } = tableLines(notes, SURVEY);
    const starts = columnStarts(header);
    expect(alignmentProblems(rows, starts)).toEqual([]);
    for (const line of [header, ...rows]) expect(displayWidth(line)).toBeLessThanOrEqual(80);
    expect(rows.every((r) => cellsAt(r, starts)[3] === "未確認")).toBe(true);
  });

  it("#33 表示：調査結果の表も、実際のプロファイルで、列がそろい、幅 80 以下（vitest の範囲 ^4 が範囲の列に出る）", async () => {
    const { notes } = await createWith(registryForReal({ vitest: ["4.1.11", "4.2.0", "5.0.0"] }), {
      version_policy: "latest",
      accepted_warnings: ["version-newer-than-verified"],
    });
    const { header, rows } = tableLines(notes, SURVEY);
    const starts = columnStarts(header);
    expect(alignmentProblems(rows, starts)).toEqual([]);
    for (const line of [header, ...rows]) expect(displayWidth(line)).toBeLessThanOrEqual(80);
    const vitest = rows.find((r) => cellsAt(r, starts)[0] === "vitest");
    expect(cellsAt(vitest ?? "", starts)[4]).toBe("^4");
    expect(cellsAt(vitest ?? "", starts)[3]).toBe("小");
    const ts = rows.find((r) => cellsAt(r, starts)[0] === "typescript");
    expect(cellsAt(ts ?? "", starts)[4]).toBe(">=6.0.0 <6.1.0");
  });
});
