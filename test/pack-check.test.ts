import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { runWithCleanup } from "../scripts/pack-check.js";

describe("#30 AC-2: pack-check の runWithCleanup", () => {
  it("#30 AC-2: 本処理も片付けも成功すると、main の戻り値が返り、cleanup は1回呼ばれる", async () => {
    const main = vi.fn(async () => "結果");
    const cleanup = vi.fn(async () => {});
    await expect(runWithCleanup(main, cleanup)).resolves.toBe("結果");
    expect(main).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("#30 AC-2: 本処理だけ失敗すると、本処理のエラーが伝わり、cleanup は1回呼ばれる", async () => {
    const mainError = new Error("本処理の失敗");
    const cleanup = vi.fn(async () => {});
    await expect(
      runWithCleanup(async () => {
        throw mainError;
      }, cleanup),
    ).rejects.toBe(mainError);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("#30 AC-2: 片付けだけ失敗すると、片付けのエラーが伝わり、cleanup は1回呼ばれる", async () => {
    const cleanupError = new Error("片付けの失敗");
    const cleanup = vi.fn(async () => {
      throw cleanupError;
    });
    await expect(runWithCleanup(async () => "結果", cleanup)).rejects.toBe(cleanupError);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("#30 AC-2: 両方失敗すると、AggregateError の errors に両方（[本処理, 片付け] の順）が入り、cleanup は1回呼ばれる", async () => {
    const mainError = new Error("本処理の失敗");
    const cleanupError = new Error("片付けの失敗");
    const cleanup = vi.fn(async () => {
      throw cleanupError;
    });
    const caught = await runWithCleanup(async () => {
      throw mainError;
    }, cleanup).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).errors).toEqual([mainError, cleanupError]);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});

describe("#34 AC-3: pack-check が、配布物からの生成を確かめる", () => {
  const script = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "pack-check.ts"),
    "utf8",
  );

  it("#34 AC-3: 「生成は Issue #34 で実装予定」を期待しなくなり、生成されたファイル（.harness/config.yaml・AGENTS.md）を確かめる", () => {
    expect(script).not.toContain("生成は Issue #34 で実装予定");
    expect(script).toContain(".harness");
    expect(script).toContain("config.yaml");
    expect(script).toContain("AGENTS.md");
  });
});
