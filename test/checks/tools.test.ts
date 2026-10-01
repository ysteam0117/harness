// 想定する型：src/checks/tools.ts（R7）
//   export type ToolName = "node" | "git" | "docker";            // npm は Node.js に付属するため調べない
//   export type ToolState = "ok" | "missing" | "outdated" | "unknown";
//   export interface ToolStatus { name: ToolName; state: ToolState; version?: string; detail?: string; guide?: string }
//     - missing・outdated：guide に導入の案内（日本語）。unknown：detail に失敗の理由（もみ消さない）
//   export type ExecFn = (file: string, args: string[]) => Promise<{ stdout: string }>;   // 見つからないときは code: "ENOENT" の Error で失敗
//   export const defaultExec: ExecFn;                            // execFile（shell なし・windowsHide: true）
//   export async function checkTools(deps?: { nodeVersion?: string; exec?: ExecFn }): Promise<ToolStatus[]>;
//     - node：deps.nodeVersion（既定は process.versions.node）が 24 以上か。起動しない
//     - git・docker：exec("git"|"docker", ["--version"])。ENOENT は missing、それ以外の失敗は unknown
import { describe, expect, it } from "vitest";
import { checkTools, defaultExec, type ExecFn } from "../../src/checks/tools.js";

const enoent = () => Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });

function fakeExec(responses: Record<string, string | Error>) {
  const calls: { file: string; args: string[] }[] = [];
  const exec: ExecFn = async (file, args) => {
    calls.push({ file, args });
    const r = responses[file];
    if (r === undefined) throw enoent();
    if (r instanceof Error) throw r;
    return { stdout: r };
  };
  return { exec, calls };
}

const find = (list: Awaited<ReturnType<typeof checkTools>>, name: string) =>
  list.find((t) => t.name === name);

describe("#32 AC-3: 手元の道具の確かめ（起動は差し替え）", () => {
  it("#32 AC-3: すべてある（node 24 以上・git・docker）と、3つとも ok", async () => {
    const { exec } = fakeExec({
      git: "git version 2.45.0",
      docker: "Docker version 27.0.1, build abc",
    });
    const list = await checkTools({ nodeVersion: "24.1.0", exec });
    expect(list.map((t) => t.name).sort()).toEqual(["docker", "git", "node"]);
    for (const t of list) expect(t.state).toBe("ok");
    expect(find(list, "git")?.version).toContain("2.45.0");
    expect(find(list, "docker")?.version).toContain("27.0.1");
  });

  it("#32 AC-3: node が 24 より古いと outdated になり、導入の案内が付く", async () => {
    const { exec } = fakeExec({ git: "git version 2.45.0", docker: "Docker version 27.0.1" });
    const list = await checkTools({ nodeVersion: "23.9.0", exec });
    expect(find(list, "node")?.state).toBe("outdated");
    expect(find(list, "node")?.guide).toMatch(/[ぁ-んァ-ヶ一-龠]/);
    expect(find(list, "git")?.state).toBe("ok");
  });

  it("#32 AC-3: git・docker が見つからない（ENOENT）と missing になり、導入の案内が付く", async () => {
    const { exec } = fakeExec({});
    const list = await checkTools({ nodeVersion: "24.0.0", exec });
    expect(find(list, "git")?.state).toBe("missing");
    expect(find(list, "docker")?.state).toBe("missing");
    expect(find(list, "git")?.guide).toMatch(/[ぁ-んァ-ヶ一-龠]/);
    expect(find(list, "docker")?.guide).toMatch(/[ぁ-んァ-ヶ一-龠]/);
    expect(find(list, "node")?.state).toBe("ok");
  });

  it("#32 AC-3: ENOENT 以外の失敗は「ない」とせず、理由を付けて unknown にする（もみ消さない）", async () => {
    const { exec } = fakeExec({
      git: Object.assign(new Error("permission denied"), { code: "EACCES" }),
      docker: "Docker version 27.0.1",
    });
    const list = await checkTools({ nodeVersion: "24.0.0", exec });
    expect(find(list, "git")?.state).toBe("unknown");
    expect(find(list, "git")?.detail).toContain("permission denied");
    expect(find(list, "docker")?.state).toBe("ok");
  });

  it("#32 AC-3: 起動するのは git と docker の --version だけ。node・npm は起動しない", async () => {
    const { exec, calls } = fakeExec({
      git: "git version 2.45.0",
      docker: "Docker version 27.0.1",
    });
    await checkTools({ nodeVersion: "24.0.0", exec });
    expect(calls.map((c) => c.file).sort()).toEqual(["docker", "git"]);
    for (const c of calls) expect(c.args).toEqual(["--version"]);
  });

  it("#32 AC-3: nodeVersion を渡さないと、実行中の process.versions.node で判定する", async () => {
    const { exec } = fakeExec({ git: "git version 2.45.0", docker: "Docker version 27.0.1" });
    const list = await checkTools({ exec });
    const major = Number(process.versions.node.split(".")[0]);
    expect(find(list, "node")?.state).toBe(major >= 24 ? "ok" : "outdated");
  });

  it("#32 AC-3: 実際の git の確かめ（1件だけ。docker は差し替え）", async () => {
    const exec: ExecFn = (file, args) =>
      file === "git" ? defaultExec(file, args) : Promise.reject(enoent());
    const list = await checkTools({ nodeVersion: "24.0.0", exec });
    expect(find(list, "git")?.state).toBe("ok");
    expect(find(list, "git")?.version).toMatch(/\d+\.\d+/);
    expect(find(list, "docker")?.state).toBe("missing");
  });
});
