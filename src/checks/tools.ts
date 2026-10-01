import { execFile } from "node:child_process";

/** npm は Node.js に付属するため調べない */
export type ToolName = "node" | "git" | "docker";
export type ToolState = "ok" | "missing" | "outdated" | "unknown";

export interface ToolStatus {
  name: ToolName;
  state: ToolState;
  version?: string;
  /** unknown のとき、確かめられなかった理由（もみ消さない） */
  detail?: string;
  /** missing・outdated のとき、導入の案内 */
  guide?: string;
}

/** 見つからないときは code: "ENOENT" の Error で失敗する */
export type ExecFn = (file: string, args: string[]) => Promise<{ stdout: string }>;

const REQUIRED_NODE_MAJOR = 24;
const EXEC_TIMEOUT_MS = 15_000;

/** shell を使わずに起動する（Windows でも同じ動き） */
export const defaultExec: ExecFn = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { windowsHide: true, timeout: EXEC_TIMEOUT_MS, encoding: "utf8" },
      (error, stdout) => {
        if (error) reject(error);
        else resolve({ stdout });
      },
    );
  });

const GUIDES: Record<ToolName, string> = {
  node: `Node.js ${REQUIRED_NODE_MAJOR} 以上を入れてください（https://nodejs.org/）`,
  git: "Git を入れてください（https://git-scm.com/）",
  docker: "Docker（Docker Desktop など）を入れてください（https://www.docker.com/）",
};

function extractVersion(stdout: string): string {
  const match = /\d+\.\d+(?:\.\d+)?/.exec(stdout);
  return match ? match[0] : stdout.trim();
}

async function checkCommand(name: "git" | "docker", exec: ExecFn): Promise<ToolStatus> {
  try {
    const { stdout } = await exec(name, ["--version"]);
    return { name, state: "ok", version: extractVersion(stdout) };
  } catch (e) {
    if ((e as { code?: unknown } | null)?.code === "ENOENT") {
      return { name, state: "missing", guide: GUIDES[name] };
    }
    const reason = e instanceof Error ? e.message : String(e);
    return { name, state: "unknown", detail: reason };
  }
}

/** 手元の道具（node・git・docker）の有無とバージョンを調べる。node は起動せず、実行中の版で判定する */
export async function checkTools(
  deps: { nodeVersion?: string; exec?: ExecFn } = {},
): Promise<ToolStatus[]> {
  const nodeVersion = deps.nodeVersion ?? process.versions.node;
  const exec = deps.exec ?? defaultExec;
  const major = Number(nodeVersion.split(".")[0]);
  const node: ToolStatus =
    major >= REQUIRED_NODE_MAJOR
      ? { name: "node", state: "ok", version: nodeVersion }
      : { name: "node", state: "outdated", version: nodeVersion, guide: GUIDES.node };
  const [git, docker] = await Promise.all([
    checkCommand("git", exec),
    checkCommand("docker", exec),
  ]);
  return [node, git, docker];
}
