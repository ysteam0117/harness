// #18 プロファイルの判定（matchProfiles）。アプリ（package.json のあるフォルダ）単位で、必須の手がかりがすべて合うときだけ当てる。
import { describe, expect, it } from "vitest";
import {
  loadDetectionRules,
  matchProfiles,
  type DetectedApp,
  type DetectedItem,
  type DetectedStack,
} from "../../src/adopt/detect.js";

const rules = loadDetectionRules();
const item = (
  cls: DetectedItem["class"],
  technology: string,
  evidence = "package.json",
): DetectedItem => ({
  class: cls,
  technology,
  evidence: [evidence],
});
const app = (
  dir: string,
  packages: string[],
  items: DetectedItem[],
  isApp = true,
  extra: { workspaces?: boolean; member?: boolean } = {},
): DetectedApp => ({
  dir,
  app: isApp,
  packages: [...packages].sort(),
  items,
  ...extra,
});
const stackOf = (...apps: DetectedApp[]): DetectedStack => ({ apps, notes: [] });
const keys = (m: ReturnType<typeof matchProfiles>) => m.applied.map((a) => a.profile);

describe("matchProfiles", () => {
  it("手がかりがすべて合うプロファイルを当てる。requires（Hono → ロガー）は解決する", () => {
    const m = matchProfiles(
      stackOf(
        app("backend", ["hono", "drizzle-orm", "vitest", "typescript"], [item("backend", "Hono")]),
        app("frontend", ["vite", "react", "react-router"], [item("frontend", "Vite")]),
      ),
      rules,
    );
    expect(keys(m)).toEqual([
      "backend-framework/hono",
      "data-access/drizzle",
      "frontend-build/vite-react-router",
      "logger/structured-logger",
      "quality/typescript-standard",
      "test-framework/vitest-playwright",
    ]);
    expect(m.applied.find((a) => a.profile === "logger/structured-logger")?.apps).toEqual([
      "backend",
    ]);
    expect(m.none).toEqual([]);
  });

  it("react-router-dom でも vite-react-router に合う", () => {
    const m = matchProfiles(stackOf(app(".", ["vite", "react-router-dom"], [])), rules);
    expect(keys(m)).toEqual(["frontend-build/vite-react-router"]);
  });

  it("一部だけ合うなら当てず、「プロファイルなし（一部一致）」にする（Vue＋vite）", () => {
    const m = matchProfiles(
      stackOf(
        app("backend", ["hono"], [item("backend", "Hono")]),
        app("frontend", ["vue", "vite"], [item("frontend", "Vue"), item("frontend", "Vite")]),
      ),
      rules,
    );
    expect(keys(m)).toContain("backend-framework/hono");
    expect(keys(m)).not.toContain("frontend-build/vite-react-router");
    expect(m.none).toEqual([
      { category: "frontend", technology: "Vite・Vue", apps: ["frontend"], partial: ["vite"] },
    ]);
  });

  it("Python（Django・pytest）は当てず、技術ごとに「プロファイルなし」にする", () => {
    const m = matchProfiles(
      stackOf(
        app(
          ".",
          [],
          [item("language", "Python"), item("backend", "Django"), item("test", "pytest")],
        ),
      ),
      rules,
    );
    expect(m.applied).toEqual([]);
    expect(m.none).toEqual([
      { category: "backend", technology: "Django", apps: ["."] },
      { category: "test", technology: "pytest", apps: ["."] },
    ]);
  });

  it("言語だけの Go は、言語を「プロファイルなし」にする", () => {
    const m = matchProfiles(stackOf(app(".", [], [item("language", "Go")])), rules);
    expect(m.applied).toEqual([]);
    expect(m.none).toEqual([{ category: "language", technology: "Go", apps: ["."] }]);
  });

  it("何もないプロジェクトは、どちらも空", () => {
    expect(matchProfiles(stackOf(app(".", [], [], false)), rules)).toEqual({
      applied: [],
      none: [],
    });
  });

  it("R2：別のアプリの手がかりは合算しない（apps/vue は vite、apps/react は react-router だけ）", () => {
    const m = matchProfiles(
      stackOf(
        app(".", [], [], false),
        app("apps/react", ["react", "react-router"], [item("frontend", "React Router")]),
        app("apps/vue", ["vue", "vite"], [item("frontend", "Vite")]),
      ),
      rules,
    );
    expect(keys(m)).not.toContain("frontend-build/vite-react-router");
    expect(m.none).toEqual([
      {
        category: "frontend",
        technology: "React Router",
        apps: ["apps/react"],
        partial: ["react-router"],
      },
      { category: "frontend", technology: "Vite", apps: ["apps/vue"], partial: ["vite"] },
    ]);
  });

  it("R2：ルートの依存（typescript）は、各アプリに共通で効く", () => {
    const m = matchProfiles(
      stackOf(
        app(".", ["typescript"], [item("quality", "TypeScript")], true, { workspaces: true }),
        app("apps/api", ["hono"], [item("backend", "Hono")], true, { member: true }),
      ),
      rules,
    );
    expect(m.applied.find((a) => a.profile === "backend-framework/hono")?.apps).toEqual([
      "apps/api",
    ]);
    expect(m.applied.find((a) => a.profile === "quality/typescript-standard")?.apps).toEqual([
      "apps/api",
    ]);
    expect(m.none).toEqual([]);
  });

  it("指摘1：ルートが実アプリ（Django）なら、子（Vue）があってもルートを対象に残す", () => {
    const m = matchProfiles(
      stackOf(
        app(".", [], [item("language", "Python"), item("backend", "Django")]),
        app("frontend", ["vue", "vite"], [item("frontend", "Vue"), item("frontend", "Vite")]),
      ),
      rules,
    );
    expect(m.none).toEqual([
      { category: "backend", technology: "Django", apps: ["."] },
      { category: "frontend", technology: "Vite・Vue", apps: ["frontend"], partial: ["vite"] },
    ]);
  });

  it("指摘1：workspaces の管理用のルート（アプリの手がかりがない）は、対象にしない", () => {
    const m = matchProfiles(
      stackOf(
        app(".", ["typescript"], [item("quality", "TypeScript")], true, { workspaces: true }),
        app("apps/api", ["hono"], [item("backend", "Hono")], true, { member: true }),
      ),
      rules,
    );
    expect(m.applied.every((a) => !a.apps.includes("."))).toBe(true);
  });

  it("指摘2：workspaces の無い独立したルートの依存（Hono）は、子（frontend/ の Vue）に合算しない", () => {
    const m = matchProfiles(
      stackOf(
        app(".", ["hono"], [item("backend", "Hono")]),
        app("frontend", ["vue"], [item("frontend", "Vue")]),
      ),
      rules,
    );
    expect(m.applied).toEqual([
      { profile: "backend-framework/hono", apps: ["."] },
      { profile: "logger/structured-logger", apps: ["."] },
    ]);
    expect(m.none).toEqual([{ category: "frontend", technology: "Vue", apps: ["frontend"] }]);
  });

  it("指摘2：ルートに workspaces があっても、所属でない子には合算しない", () => {
    const m = matchProfiles(
      stackOf(
        app(".", ["typescript"], [item("quality", "TypeScript")], true, { workspaces: true }),
        app("tools", ["hono"], [item("backend", "Hono")]),
      ),
      rules,
    );
    expect(keys(m)).not.toContain("quality/typescript-standard");
    expect(m.none).toEqual([]);
  });

  it("指摘2：ルートが Go（go.mod）で子が Vue なら、Go の「プロファイルなし」も出す", () => {
    const m = matchProfiles(
      stackOf(
        app(".", [], [item("language", "Go", "go.mod")]),
        app("frontend", ["vue"], [item("frontend", "Vue")]),
      ),
      rules,
    );
    expect(m.none).toEqual([
      { category: "language", technology: "Go", apps: ["."] },
      { category: "frontend", technology: "Vue", apps: ["frontend"] },
    ]);
  });

  it("指摘2：workspaces があっても、go.mod 等の言語のファイルがあるルートは実アプリとして残す", () => {
    const m = matchProfiles(
      stackOf(
        app(".", [], [item("language", "Go", "go.mod")], true, { workspaces: true }),
        app("apps/web", ["vue"], [item("frontend", "Vue")], true, { member: true }),
      ),
      rules,
    );
    expect(m.none.map((n) => n.technology)).toEqual(["Go", "Vue"]);
  });

  it("指摘2：workspaces の無い独立した TypeScript のルートは、品質のプロファイルを落とさない", () => {
    const m = matchProfiles(
      stackOf(
        app(".", ["typescript"], [item("quality", "TypeScript"), item("language", "TypeScript")]),
        app("frontend", ["vue"], [item("frontend", "Vue")]),
      ),
      rules,
    );
    expect(m.applied).toEqual([{ profile: "quality/typescript-standard", apps: ["."] }]);
    expect(m.none).toEqual([{ category: "frontend", technology: "Vue", apps: ["frontend"] }]);
  });

  it("R2：あるアプリは一致・別のアプリは別の技術なら、一致のほうは当てて、別のアプリを「プロファイルなし」にする", () => {
    const m = matchProfiles(
      stackOf(
        app(".", [], [], false),
        app(
          "apps/web",
          ["vite", "react", "react-router"],
          [item("frontend", "Vite"), item("frontend", "React Router")],
        ),
        app("apps/admin", ["vue", "vite"], [item("frontend", "Vue"), item("frontend", "Vite")]),
      ),
      rules,
    );
    expect(m.applied).toEqual([
      { profile: "frontend-build/vite-react-router", apps: ["apps/web"] },
    ]);
    expect(m.none).toEqual([
      { category: "frontend", technology: "Vite・Vue", apps: ["apps/admin"], partial: ["vite"] },
    ]);
  });

  it("R2：2つのアプリで別々のフロントなら、アプリごとの結果を残す", () => {
    const m = matchProfiles(
      stackOf(
        app("apps/a", ["vite", "react-router"], [item("frontend", "Vite")]),
        app("apps/b", ["vite", "react-router-dom"], [item("frontend", "Vite")]),
        app("apps/c", ["svelte"], [item("frontend", "Svelte")]),
      ),
      rules,
    );
    expect(m.applied).toEqual([
      { profile: "frontend-build/vite-react-router", apps: ["apps/a", "apps/b"] },
    ]);
    expect(m.none).toEqual([{ category: "frontend", technology: "Svelte", apps: ["apps/c"] }]);
  });

  it("結果の並びは固定（アプリの並びが違っても同じ）", () => {
    const a = app("b", ["hono"], [item("backend", "Hono")]);
    const b = app("a", ["vitest"], [item("test", "Vitest")]);
    expect(matchProfiles(stackOf(a, b), rules)).toEqual(matchProfiles(stackOf(b, a), rules));
  });
});
