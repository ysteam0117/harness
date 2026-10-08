// #21：基準線の確認のスクリプト（.harness/scripts/baseline-check.mjs）を導入物に含める条件。
import { afterEach, describe, expect, it } from "vitest";
import { buildAdoptFiles } from "../../src/adopt/build.js";
import { BASELINE_SCRIPT_PATH } from "../../src/adopt/ci.js";
import { isManagedPath } from "../../src/generate/project.js";
import { cleanupProjectTmp, completeAnswers } from "../generate/project-helpers.js";

afterEach(cleanupProjectTmp);

async function build(over: Record<string, unknown>, nodeDirs: string[]) {
  return buildAdoptFiles({ answers: await completeAnswers(over), nodeDirs });
}

describe("#21：baseline-check.mjs を導入物に含める", () => {
  it("パスは .harness/scripts/baseline-check.mjs。管理するファイル（update で置き換える）。baseline.json は管理しない", () => {
    expect(BASELINE_SCRIPT_PATH).toBe(".harness/scripts/baseline-check.mjs");
    expect(isManagedPath(BASELINE_SCRIPT_PATH)).toBe(true);
    expect(isManagedPath(".harness/baseline.json")).toBe(false);
    expect(isManagedPath(".harness/scripts/other.mjs")).toBe(false);
  });

  it("repository: local でも、Node のアプリがあればスクリプトを含む。harness-check.yml は含まない", async () => {
    const files = await build({ repository: "local", check_location: "local" }, ["app"]);
    const script = files.find((f) => f.path === BASELINE_SCRIPT_PATH);
    expect(script?.kind).toBe("file");
    expect(script?.content).toContain('["app"]');
    expect(script?.content).not.toMatch(/\{\{[a-z_]+\}\}/);
    expect(files.some((f) => f.path === ".github/workflows/harness-check.yml")).toBe(false);
  });

  it("GitHub Actions で確認する場合も、スクリプトを含む", async () => {
    const files = await build({ repository: "github", check_location: "both" }, ["app"]);
    expect(files.some((f) => f.path === BASELINE_SCRIPT_PATH)).toBe(true);
    expect(files.some((f) => f.path === ".github/workflows/harness-check.yml")).toBe(true);
  });

  it("Node のアプリがない（Node 以外）：スクリプトを含まない", async () => {
    const files = await build({}, []);
    expect(files.some((f) => f.path === BASELINE_SCRIPT_PATH)).toBe(false);
  });

  it("使えない名前のフォルダ（絶対パスなど）だけのときも、含めない。埋め込む配列にも入れない", async () => {
    expect((await build({}, ["../x", "/y"])).some((f) => f.path === BASELINE_SCRIPT_PATH)).toBe(
      false,
    );
    const files = await build({}, ["ok", "../x"]);
    const text = files.find((f) => f.path === BASELINE_SCRIPT_PATH)?.content ?? "";
    expect(text).toContain('["ok"]');
    expect(text).not.toContain("../x");
  });

  it("baseline.json は導入物にない（adopt は測らない）", async () => {
    const files = await build({}, ["app"]);
    expect(files.some((f) => f.path.endsWith("baseline.json"))).toBe(false);
  });

  it("同じ入力なら同じ結果（並びは変わらない）", async () => {
    const a = await build({}, ["b", "a"]);
    const b = await build({}, ["a", "b"]);
    expect(a).toEqual(b);
  });
});

describe("#21：AGENTS.md に基準線の実行方法を書く（Node のアプリがあるときだけ）", () => {
  it("あるとき：印の中に実行方法がある。ないとき：書かない", async () => {
    const withApp = (await build({ repository: "local", check_location: "local" }, ["app"])).find(
      (f) => f.path === "AGENTS.md",
    );
    expect(withApp?.content).toContain("node .harness/scripts/baseline-check.mjs");
    expect(withApp?.content).toContain("ADR");
    const without = (await build({ repository: "local", check_location: "local" }, [])).find(
      (f) => f.path === "AGENTS.md",
    );
    expect(without?.content).not.toContain("baseline-check");
  });
});
