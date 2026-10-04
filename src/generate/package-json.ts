import { major, valid } from "semver";
import type { Answers } from "../questions/answers.js";
import type { VersionResult } from "../versions/choose.js";
import { wantedPackages } from "../versions/targets.js";
import { isPlainObject } from "./data.js";
import { GenerateError } from "./errors.js";
import { mergePackageJson, type Profile } from "./profile.js";

export interface BuildPackageJsonInput {
  appName: string;
  /** packages_when の条件（database など）に使う */
  answers: Answers;
  /** 選んだプロファイル（resolveProfiles の結果） */
  profiles: Profile[];
  /** #33 で選んだ版。"node" の項目が Node.js の版 */
  versions: VersionResult;
}

/** プロファイルの package_json が書いてはいけない項目（ハーネスが決める） */
const FIXED_KEYS = [
  "name",
  "version",
  "private",
  "type",
  "engines",
  "dependencies",
  "devDependencies",
];

/** GitHub を使わない（手元の Git だけ）場合に、取り込みのコマンドを scripts に足す（C-83） */
function withLocalGitScripts(
  merged: Record<string, unknown>,
  answers: Answers,
): Record<string, unknown> {
  if (answers.repository !== "local") return merged;
  const scripts = isPlainObject(merged["scripts"]) ? merged["scripts"] : {};
  return { ...merged, scripts: { ...scripts, "merge:check": "node scripts/merge-check.mjs" } };
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * 生成するプロジェクトの package.json を組み立てる。
 * 選ばれた（packages ＋ 回答に合う packages_when）パッケージを、正確な版（^・~ なし）で、
 * dev_packages にあれば devDependencies、なければ dependencies に入れる（名前の昇順）。
 * 同じ入力なら、キーの並びも含めて同じ中身になる。
 */
export function buildPackageJson(input: BuildPackageJsonInput): Record<string, unknown> {
  const { appName, answers, profiles, versions } = input;

  const adopted = new Map<string, string>();
  for (const entry of versions.entries) adopted.set(entry.name, entry.version);
  const nodeVersion = adopted.get("node");
  if (nodeVersion === undefined || valid(nodeVersion) === null) {
    throw new GenerateError("package.json の engines に使う Node.js の版が、選んだ版にありません");
  }

  // パッケージ名 → すべてのプロファイルが dev_packages に書いているか
  const isDev = new Map<string, boolean>();
  for (const profile of profiles) {
    for (const name of wantedPackages(profile, answers)) {
      const dev = profile.devPackages.includes(name);
      isDev.set(name, (isDev.get(name) ?? true) && dev);
    }
  }

  const dependencies: Record<string, string> = {};
  const devDependencies: Record<string, string> = {};
  for (const name of [...isDev.keys()].sort(compare)) {
    const version = adopted.get(name);
    if (version === undefined) {
      throw new GenerateError(
        `パッケージ ${name} の版が、選んだ版にありません（package.json に入れられません）`,
      );
    }
    (isDev.get(name) ? devDependencies : dependencies)[name] = version;
  }

  const merged = withLocalGitScripts(mergePackageJson(profiles, answers), answers);
  for (const key of FIXED_KEYS) {
    if (Object.hasOwn(merged, key)) {
      throw new GenerateError(
        `プロファイルの package_json に、ハーネスが決める項目 ${key} が書かれています`,
      );
    }
  }

  return {
    name: appName,
    version: "0.0.0",
    private: true,
    type: "module",
    engines: { node: `>=${String(major(nodeVersion))}` },
    ...merged,
    ...(Object.keys(dependencies).length > 0 ? { dependencies } : {}),
    ...(Object.keys(devDependencies).length > 0 ? { devDependencies } : {}),
  };
}
