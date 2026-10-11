// #6 PR-C：プロファイルを読む途中の GenerateError でも、status は例外の本文（パス・名前）を出さず、終了コード0
import { afterEach, describe, expect, it, vi } from "vitest";
import { runStatus } from "../../src/commands/status.js";
import { GenerateError } from "../../src/generate/errors.js";
import { cleanupRoots, editConfig, freshProject } from "../update/helpers.js";
import { offlineFetch } from "../versions/helpers.js";

const armed = vi.hoisted(() => ({ on: false }));

vi.mock("../../src/versions/range-review.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/versions/range-review.js")>();
  return {
    ...original,
    rangeTargetsFor: (...args: Parameters<typeof original.rangeTargetsFor>) => {
      if (armed.on) throw new GenerateError("読めません：/home/someone/SECRET-app/profile.yaml");
      return original.rangeTargetsFor(...args);
    },
  };
});

afterEach(cleanupRoots);

describe("#6 AC-5: status は、GenerateError の本文を出さない", () => {
  it("固定の文で「取得できません」と表示する", async () => {
    const dir = await freshProject();
    editConfig(dir, (doc) => {
      doc["harness_version"] = "0.1.0";
    });
    armed.on = true;
    const outs: string[] = [];
    const errs: string[] = [];
    const out = await runStatus(
      {},
      {
        cwd: dir,
        stdout: (s) => outs.push(s),
        stderr: (s) => errs.push(s),
        runGh: async () => ({ code: 1, stdout: "", stderr: "" }),
        repository: () => "testowner/harness",
        changelog: () => "# 変更履歴\n",
        harnessVersion: () => "0.2.0",
        fetch: offlineFetch().fn,
      },
    );
    expect(out.exitCode).toBe(0);
    const text = outs.join("");
    expect(text).toContain(
      "取得できません（このハーネスでは、記録された回答のプロファイルを読めません）",
    );
    for (const word of ["SECRET", "someone", "profile.yaml"]) {
      expect(text).not.toContain(word);
      expect(errs.join("")).not.toContain(word);
    }
  });
});
