// #63 文書と GitHub のファイルのひな形：生成するプロジェクトの内容（メモリ上の buildProject の結果）のテスト
//
// 想定する仕様（実装の役割はこの形に合わせる）
//   常に出す（プロジェクトのもの。managed は false）
//     docs/requirements.md：F-26 の判定の結果（回答・ASVS のレベル・ペネトレーションテストの要否・有効にしたルール・未定の項目）
//     docs/adr/README.md・docs/adr/0000-template.md（背景・選択肢・決定・理由・影響）
//     docs/testing/README.md と、テストの種類ごとの手順書（quality・unit・integration・e2e・mutation）。
//       手順書は C-69 の6つの見出し（必要なもの・構築の手順・確認の方法・テストの実行方法・後始末・よくある失敗と対処）を持つ
//     prototype/README.md・index.html・style.css・app.js（C-76。架空のデータだけ）
//     仮のアイコン（C-55）：public/favicon.ico・favicon.svg・apple-touch-icon.png（180）・icons/icon-192.png・icons/icon-512.png・
//       manifest.webmanifest。PNG・ICO は encoding: "base64" で持つ。index.html から参照する
//   GitHub のファイル（ハーネスが管理するもの。managed は true）
//     .github/pull_request_template.md（「知見」の欄。F-18）、.github/ISSUE_TEMPLATE/parent.md・child.md・replace-icons.md（C-07・C-55）
//   条件つき
//     .github/workflows/check.yml：品質チェックの実行場所が github_actions・both のときだけ（F-16）。プロジェクトのもの
//     LICENSE（MIT）：公開のときだけ
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { buildProject, type ProjectFile } from "../../src/generate/project.js";
import { contentOf, pathsOf, projectInput } from "./project-helpers.js";

async function generate(over: Record<string, unknown> = {}): Promise<ProjectFile[]> {
  return buildProject(await projectInput(over)).files;
}

function fileOf(files: ProjectFile[], p: string): ProjectFile {
  const f = files.find((x) => x.path === p);
  if (!f) throw new Error(`出力に ${p} がありません`);
  return f;
}

/** PNG の幅と高さ（IHDR） */
function pngSize(bytes: Buffer): { width: number; height: number } {
  expect(bytes.subarray(0, 8)).toEqual(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  expect(bytes.subarray(12, 16).toString("latin1")).toBe("IHDR");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

const binary = (f: ProjectFile): Buffer => {
  expect(f.encoding).toBe("base64");
  return Buffer.from(f.content, "base64");
};

const TESTING_DOCS = ["quality", "unit", "integration", "e2e", "mutation"].map(
  (name) => `docs/testing/${name}.md`,
);
const C69_HEADINGS = [
  "## 1. 必要なもの",
  "## 2. 構築の手順",
  "## 3. 確認の方法",
  "## 4. テストの実行方法",
  "## 5. 後始末",
  "## 6. よくある失敗と対処",
];
const ICON_FILES = [
  "public/favicon.ico",
  "public/favicon.svg",
  "public/apple-touch-icon.png",
  "public/icons/icon-192.png",
  "public/icons/icon-512.png",
  "public/manifest.webmanifest",
];
const GITHUB_MANAGED = [
  ".github/pull_request_template.md",
  ".github/ISSUE_TEMPLATE/parent.md",
  ".github/ISSUE_TEMPLATE/child.md",
  ".github/ISSUE_TEMPLATE/replace-icons.md",
];

describe("要件定義書のひな形（F-26 の判定の結果）", () => {
  it("すべて決まっていてリスクがない回答では、レベル1・任意・未定なしが書かれる", async () => {
    const text = contentOf(await generate(), "docs/requirements.md");
    expect(text).toContain("# testapp-001 の要件定義書");
    expect(text).toContain("ASVSのレベル：1");
    expect(text).toContain("ペネトレーションテスト：任意（推奨）");
    expect(text).toContain("| A | 個人情報の扱い | 扱わない |");
    expect(text).toContain("| G | 止まったときの影響 | 止まっても許容できる |");
    expect(text).toMatch(/## 未定の項目\n\nなし\n/);
    expect(text).toMatch(/有効にした共通仕様：なし/);
  });

  it("未定の項目と、有効にしたルール・必須の理由が書かれる", async () => {
    const text = contentOf(
      await generate({ personal_data: "undecided", admin: "yes" }),
      "docs/requirements.md",
    );
    expect(text).toContain("ASVSのレベル：2");
    expect(text).toContain("初回のリリースの前に必須");
    expect(text).toContain("| A | 個人情報の扱い | 未定 |");
    expect(text).toContain("- A：個人情報の扱い（`personal_data`）");
    expect(text).not.toContain("- B：");
    expect(text).toContain("有効にした共通仕様：C-09、C-14、C-19、C-20、C-30");
  });

  it("プロジェクトのもの（managed ではない）", async () => {
    expect(fileOf(await generate(), "docs/requirements.md").managed).toBe(false);
  });
});

describe("ADR・テストの手順書（C-35・C-69）", () => {
  it("ADR の README とひな形が出る。ひな形は背景・選択肢・決定・理由・影響を持つ", async () => {
    const files = await generate();
    expect(pathsOf(files)).toEqual(
      expect.arrayContaining(["docs/adr/README.md", "docs/adr/0000-template.md"]),
    );
    const template = contentOf(files, "docs/adr/0000-template.md");
    for (const h of ["## 背景", "## 選択肢", "## 決定", "## 理由", "## 影響"]) {
      expect(template).toContain(h);
    }
  });

  it("テストの種類ごとの手順書が、C-69 の6つの見出しを持つ", async () => {
    const files = await generate();
    expect(contentOf(files, "docs/testing/README.md")).toContain("pentest-plan.md");
    for (const p of TESTING_DOCS) {
      const text = contentOf(files, p);
      for (const h of C69_HEADINGS) expect(text, `${p} に ${h}`).toContain(h);
      expect(fileOf(files, p).managed).toBe(false);
    }
  });

  it("結合テストの手順書は、DB の種類に合わせた内容になる", async () => {
    const pg = contentOf(
      await generate({ database: "postgresql", postgres_provider: "neon" }),
      "docs/testing/integration.md",
    );
    expect(pg).toContain("docker:up:test");
    const none = contentOf(
      await generate({ database: "none", auth: "none" }),
      "docs/testing/integration.md",
    );
    expect(none).toContain("DBは使わない");
  });
});

describe("GitHub のファイル（F-16・F-18・C-07）", () => {
  it("PR のテンプレートに「知見」の欄があり、Issue のテンプレートと一緒に管理するファイルになる", async () => {
    const files = await generate();
    expect(contentOf(files, ".github/pull_request_template.md")).toContain("## 知見");
    expect(contentOf(files, ".github/ISSUE_TEMPLATE/child.md")).toContain("AC-1");
    expect(contentOf(files, ".github/ISSUE_TEMPLATE/parent.md")).toContain("子Issue");
    for (const p of GITHUB_MANAGED) expect(fileOf(files, p).managed, p).toBe(true);

    const config = parse(contentOf(files, ".harness/config.yaml")) as {
      managed_files: Record<string, string>;
    };
    for (const p of GITHUB_MANAGED) expect(Object.keys(config.managed_files)).toContain(p);
    expect(Object.keys(config.managed_files)).not.toContain("docs/requirements.md");
  });

  it.each([
    ["github_actions", true],
    ["both", true],
    ["local", false],
  ] as const)("品質チェックの実行場所が %s なら、ワークフローの有無は %s", async (where, has) => {
    const files = await generate({ check_location: where });
    expect(pathsOf(files).includes(".github/workflows/check.yml")).toBe(has);
    if (has) {
      const wf = parse(contentOf(files, ".github/workflows/check.yml")) as {
        jobs: Record<string, { steps: { run?: string }[] }>;
      };
      const runs = Object.values(wf.jobs).flatMap((j) => j.steps.map((s) => s.run ?? ""));
      expect(runs).toEqual(expect.arrayContaining(["npm ci", "npm run check"]));
      expect(fileOf(files, ".github/workflows/check.yml").managed).toBe(false);
    }
  });
});

describe("LICENSE（公開のときだけ）", () => {
  it("公開なら MIT の LICENSE が、生成した年で出る", async () => {
    const text = contentOf(await generate({ visibility: "public" }), "LICENSE");
    expect(text).toMatch(/^MIT License\n/);
    expect(text).toContain("Copyright (c) 2026 testapp-001 contributors");
  });

  it("非公開なら出ない", async () => {
    expect(pathsOf(await generate({ visibility: "private" }))).not.toContain("LICENSE");
  });
});

describe("プロトタイプ（C-76）", () => {
  it("HTML・CSS・JavaScript だけで、架空のデータを使う", async () => {
    const files = await generate();
    for (const p of [
      "prototype/README.md",
      "prototype/index.html",
      "prototype/style.css",
      "prototype/app.js",
    ]) {
      expect(fileOf(files, p).managed, p).toBe(false);
    }
    const html = contentOf(files, "prototype/index.html");
    expect(html).not.toMatch(/<script[^>]+src="https?:/);
    const js = contentOf(files, "prototype/app.js");
    expect(js).not.toMatch(/fetch\(|import /);
    for (const state of ["loading", "data", "empty", "error"]) expect(js).toContain(state);
    for (const email of js.match(/[\w.+-]+@[\w.-]+/g) ?? []) {
      expect(email).toMatch(/@example\.(com|org|net)$/);
    }
  });
});

describe("仮のアイコン（C-55）", () => {
  it("ファビコン・ホーム画面用・Web App Manifest 用のアイコンが、決まった大きさで出る", async () => {
    const files = await generate();
    expect(pathsOf(files)).toEqual(expect.arrayContaining(ICON_FILES));
    expect(pngSize(binary(fileOf(files, "public/apple-touch-icon.png")))).toEqual({
      width: 180,
      height: 180,
    });
    expect(pngSize(binary(fileOf(files, "public/icons/icon-192.png")))).toEqual({
      width: 192,
      height: 192,
    });
    expect(pngSize(binary(fileOf(files, "public/icons/icon-512.png")))).toEqual({
      width: 512,
      height: 512,
    });

    const ico = binary(fileOf(files, "public/favicon.ico"));
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(1);
    const offset = ico.readUInt32LE(18);
    expect(pngSize(ico.subarray(offset))).toEqual({ width: 32, height: 32 });

    const svg = contentOf(files, "public/favicon.svg");
    expect(svg).toContain(">T<");
    const manifest = JSON.parse(contentOf(files, "public/manifest.webmanifest")) as {
      name: string;
      icons: { src: string; sizes: string }[];
    };
    expect(manifest.name).toBe("testapp-001");
    expect(manifest.icons.map((i) => i.sizes)).toEqual(["192x192", "512x512"]);
  });

  it("同じ回答なら同じ画像になる", async () => {
    const a = fileOf(await generate(), "public/icons/icon-512.png").content;
    const b = fileOf(await generate(), "public/icons/icon-512.png").content;
    expect(a).toBe(b);
  });

  it("index.html から参照し、README に仮の画像であることと差し替えの Issue の作り方が書かれる", async () => {
    const files = await generate();
    const html = contentOf(files, "index.html");
    for (const href of [
      "/favicon.ico",
      "/favicon.svg",
      "/apple-touch-icon.png",
      "/manifest.webmanifest",
    ]) {
      expect(html).toContain(`href="${href}"`);
    }
    const readme = contentOf(files, "README.md");
    expect(readme).toContain("仮のアイコン");
    expect(readme).toContain("replace-icons");
    expect(readme).toContain("ブランチの保護");
  });
});
