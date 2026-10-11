// #6 PR-B：生成・書き込みの例外の本文（絶対パス・アプリ名・一時フォルダを含みうる）は、表にも下書きにも入れない。
import { readdirSync } from "node:fs";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { renderRangeFeedbackDraft } from "../../src/versions/range-feedback.js";
import { candidatesOf } from "../../src/versions/range-review.js";
import { formatTrialResults } from "../../src/versions/range-trial-messages.js";
import { runRangeTrials, type RangeTrialInput } from "../../src/versions/range-trial.js";
import { cleanupTmp, makeTmp } from "../questions/helpers.js";
import { makeRunner, prepareMain } from "./range-trial-helpers.js";

const hooks = vi.hoisted(() => ({
  build: undefined as (() => never) | undefined,
  write: undefined as (() => never) | undefined,
}));

vi.mock("../../src/generate/project.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/generate/project.js")>();
  return {
    ...actual,
    buildProject: ((input) =>
      hooks.build ? hooks.build() : actual.buildProject(input)) as typeof actual.buildProject,
  };
});

vi.mock("../../src/generate/write.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/generate/write.js")>();
  return {
    ...actual,
    writeProject: ((input) =>
      hooks.write ? hooks.write() : actual.writeProject(input)) as typeof actual.writeProject,
  };
});

afterEach(() => {
  hooks.build = undefined;
  hooks.write = undefined;
  cleanupTmp();
});

type Main = Awaited<ReturnType<typeof prepareMain>>;
let main: Main;
beforeAll(async () => {
  main = await prepareMain();
}, 120_000);

const SECRET_PATH = "C:\\Users\\someone\\secret-dir\\testapp-001";

async function trial() {
  const tmpRoot = makeTmp().cwd;
  const details: string[] = [];
  const runner = makeRunner();
  if (!main.rangeReview || !main.answers || !main.versions) throw new Error("準備できていません");
  const input: RangeTrialInput = {
    candidates: candidatesOf(main.rangeReview),
    answers: main.answers,
    acceptedWarnings: main.acceptedWarnings ?? [],
    versions: main.versions,
    now: new Date("2026-10-03T12:00:00Z"),
    runner: runner.runner,
    dockerAvailable: async () => true,
    signal: new AbortController().signal,
    tmpRoot,
    onDetail: (m) => details.push(m),
  };
  return { results: await runRangeTrials(input), details, tmpRoot, runner };
}

describe("#6 PR-B：例外の本文を結果にも下書きにも入れない", () => {
  it.each([
    ["build", "build-failed"],
    ["write", "write-failed"],
  ] as const)(
    "%s が絶対パス・アプリ名つきの例外：分類だけを持ち、表と下書きに含まれない（詳細は onDetail だけ）",
    async (which, reason) => {
      hooks[which] = () => {
        throw new Error(`失敗 ${SECRET_PATH} testapp-001`);
      };
      const { results, details, tmpRoot, runner } = await trial();
      for (const r of results) expect(r.outcome).toEqual({ kind: "skipped", reason });
      if (!main.rangeReview) throw new Error("準備できていません");
      const shown = formatTrialResults(results);
      const draft = renderRangeFeedbackDraft(main.rangeReview, results) ?? "";
      for (const text of [shown, draft, JSON.stringify(results)]) {
        expect(text).not.toContain("secret-dir");
        expect(text).not.toContain("testapp-001");
      }
      expect(draft).toContain("未試行（");
      expect(details.join("\n")).toContain("secret-dir");
      expect(runner.calls).toHaveLength(0);
      expect(readdirSync(tmpRoot)).toEqual([]);
    },
  );
});
