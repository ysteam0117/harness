// 想定する型：src/questions/prompter.ts（test/questions/helpers.ts の冒頭を参照）
//   createClackPrompter(): Prompter   本番。@clack/prompts の結果が isCancel なら CancelledError を投げる
import { describe, expect, it, vi } from "vitest";

const CANCEL = Symbol.for("test-cancel");
vi.mock("@clack/prompts", () => ({
  text: vi.fn(async () => CANCEL),
  select: vi.fn(async () => CANCEL),
  multiselect: vi.fn(async () => CANCEL),
  confirm: vi.fn(async () => CANCEL),
  note: vi.fn(),
  isCancel: (v: unknown) => v === CANCEL,
  cancel: vi.fn(),
}));

import { CancelledError, createClackPrompter } from "../../src/questions/prompter.js";

describe("#32 AC-5: Ctrl+C は CancelledError になる", () => {
  it("#32 AC-5: CancelledError は Error の一種", () => {
    expect(new CancelledError()).toBeInstanceOf(Error);
  });

  const options = [{ value: "a", label: "あ" }];
  it("#32 AC-5: text・select・multiselect・confirm のどれでも、取り消しは CancelledError", async () => {
    const p = createClackPrompter();
    await expect(p.text({ id: "x", message: "m" })).rejects.toBeInstanceOf(CancelledError);
    await expect(p.select({ id: "x", message: "m", options })).rejects.toBeInstanceOf(
      CancelledError,
    );
    await expect(p.multiselect({ id: "x", message: "m", options })).rejects.toBeInstanceOf(
      CancelledError,
    );
    await expect(p.confirm({ id: "x", message: "m" })).rejects.toBeInstanceOf(CancelledError);
  });
});
