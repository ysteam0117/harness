// #39 AC-2: Java の版の選び方。公開されている LTS を、プロファイルの範囲で絞り、その中の最新を採る。
import { describe, expect, it } from "vitest";
import { chooseVersions, type VersionEntry } from "../../src/versions/choose.js";
import { safeReason } from "../../src/versions/status-review.js";
import type { Target } from "../../src/versions/targets.js";
import { FakePrompter } from "../questions/helpers.js";
import { FIXED_NOW } from "./helpers.js";
import { fakeMaven } from "./maven-helpers.js";

const java = (range?: string): Target => ({
  kind: "java",
  name: "java",
  verified: "25",
  unverified: false,
  profiles: ["lib/example-jvm"],
  ...(range !== undefined ? { range } : {}),
});

async function pick(
  target: Target,
  lts: number[] | Error,
  over: { policy?: "verified" | "latest"; offline?: boolean } = {},
) {
  const prompter = new FakePrompter({});
  const f = fakeMaven({ java: lts instanceof Error ? lts : { available_lts_releases: lts } });
  const out = await chooseVersions({
    targets: [target],
    policy: over.policy ?? "latest",
    interactive: false,
    prompter,
    fetch: f.fn,
    now: FIXED_NOW,
    ...(over.offline ? { versionsOffline: "verified" as const } : {}),
  });
  return { out, prompter };
}

function entryOf(out: Awaited<ReturnType<typeof pick>>["out"]): VersionEntry {
  if (out.status !== "ok") throw new Error(`stopped：${out.message}`);
  const e = out.result.entries[0];
  if (!e) throw new Error("結果がありません");
  return e;
}

describe("#39 AC-2: Java の版の選び方", () => {
  it("範囲なし → 公開 LTS の最新", async () => {
    const e = entryOf((await pick(java(), [17, 21, 25, 29])).out);
    expect(e).toMatchObject({ name: "java", version: "29", latestStable: "29", verified: "25" });
    expect(e.majorDiffers).toBe(true);
  });

  it("公開 LTS [21, 25]・範囲 >=21 <25 → 範囲内の旧い LTS（21）を採る", async () => {
    const e = entryOf((await pick(java(">=21 <25"), [21, 25])).out);
    expect(e.version).toBe("21");
    expect(e.reason).toContain("LTS");
  });

  it("公開 LTS [21, 25]・範囲 >=17 <21 → 範囲に入る LTS がないので検証済み（25）に戻す", async () => {
    // 範囲と検証済みが食い違うのはプロファイルの誤りだが、選び方としては検証済みに戻す
    const target = { ...java(">=17 <21"), verified: "25" };
    const e = entryOf((await pick(target, [21, 25])).out);
    expect(e.version).toBe("25");
    expect(e.latestStatus).toBe("none_in_range");
    expect(e.reason).toContain("検証済み");
  });

  it("version_policy が verified → 常に検証済み（25）。最新は記録する", async () => {
    const e = entryOf((await pick(java(">=21 <27"), [21, 25, 29], { policy: "verified" })).out);
    expect(e.version).toBe("25");
    expect(e.latestStable).toBe("25");
  });

  it("取得に失敗 → 検証済み（25）に戻す。理由は固定の分類で示せる", async () => {
    const { out } = await pick(java(">=21 <27"), new Error("ECONNREFUSED /secret/path (fake)"), {
      offline: true,
    });
    const e = entryOf(out);
    expect(e.version).toBe("25");
    expect(e.latestStatus).toBe("failed");
    expect(safeReason(e.fetchFailure ?? "")).toBe("接続できません");
    expect(safeReason("HTTP 503 が返されました（https://api.adoptium.net/）")).toBe("HTTP 503");
    expect(safeReason("応答を読めません（https://example.com/）")).toBe("応答を読めません");
  });

  it("取得に失敗して versions_offline がなければ、止まる（Node.js と同じ）", async () => {
    const { out } = await pick(java(), new Error("fake"));
    expect(out.status).toBe("stopped");
  });
});
