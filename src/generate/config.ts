import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { AcceptedWarning } from "../checks/review.js";
import type { Answers } from "../questions/answers.js";
import { questionDefinitions } from "../questions/definitions.js";
import type { VersionResult } from "../versions/choose.js";
import { GenerateError } from "./errors.js";
import type { Judgment } from "./judgment.js";
import type { RoleModel } from "./roles.js";
import { normalizeNewlines } from "./template.js";

export const CONFIG_PATH = ".harness/config.yaml";

/** ファイルの指紋。改行を LF にそろえた中身の sha256（16進・小文字） */
export function fingerprint(content: string): string {
  return createHash("sha256").update(normalizeNewlines(content), "utf8").digest("hex");
}

/** 日付（YYYY-MM-DD）。ローカルの日付 */
export function localDay(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${String(now.getFullYear())}-${month}-${day}`;
}

let cachedVersion: string | undefined;

/** ハーネス自身の package.json の version */
export function harnessVersion(): string {
  if (cachedVersion !== undefined) return cachedVersion;
  const file = fileURLToPath(new URL("../../package.json", import.meta.url));
  try {
    const pkg = JSON.parse(readFileSync(file, "utf8")) as { version?: unknown };
    if (typeof pkg.version !== "string" || pkg.version === "") {
      throw new Error("version がありません");
    }
    cachedVersion = pkg.version;
    return cachedVersion;
  } catch (e) {
    throw new GenerateError(
      `ハーネスのバージョンを package.json から読めません：${file}（${(e as Error).message}）`,
      { cause: e },
    );
  }
}

export interface BuildConfigInput {
  answers: Answers;
  acceptedWarnings: AcceptedWarning[];
  judgment: Judgment;
  versions: VersionResult;
  /** 選んだAIの分だけの、役割 → モデル */
  roles: Record<string, RoleModel>;
  /** ハーネスが管理するファイルのパス → 中身 */
  managed: { path: string; content: string }[];
  now: Date;
}

const HEADER = `# ハーネス（harness）が生成した記録です。ハーネスの更新（harness update）に使います。
# managed_files は、ハーネスが管理するファイルの指紋です。手で書き換えると、更新のときに差分として扱われます。
`;

/** 質問の順に並べた回答（値のないものは除く）。同じ回答なら同じ並びになる */
function orderedAnswers(answers: Answers): Record<string, unknown> {
  const record = answers as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const def of questionDefinitions) {
    if (record[def.id] !== undefined) out[def.id] = record[def.id];
  }
  return out;
}

/** .harness/config.yaml の中身（YAML） */
export function buildConfigText(input: BuildConfigInput): string {
  const managedFiles: Record<string, string> = {};
  for (const file of [...input.managed].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    managedFiles[file.path] = fingerprint(file.content);
  }
  const doc = {
    harness_version: harnessVersion(),
    generated_on: localDay(input.now),
    mode: "create",
    answers: orderedAnswers(input.answers),
    accepted_warnings: input.acceptedWarnings.map((w) => ({
      id: w.id,
      message: w.message,
      reason: w.reason,
    })),
    judgment: {
      asvs_level: input.judgment.asvsLevel,
      pentest_required: input.judgment.pentestRequired,
      undecided: input.judgment.undecided,
      enabled_rules: input.judgment.enabledRules,
    },
    versions: input.versions.entries.map((e) => ({
      name: e.name,
      version: e.version,
      reason: e.reason,
      surveyed_on: e.surveyedOn,
      latest_stable: e.latestStable,
      verified: e.verified,
    })),
    roles: input.roles,
    managed_files: managedFiles,
  };
  return HEADER + stringifyYaml(doc, { lineWidth: 0 });
}

export interface UpdateConfigInput {
  /** 最初に生成した日（引き継ぐ） */
  generatedOn: string;
  /** 更新した日 */
  updatedOn: string;
  /** 実際に残る中身の指紋（パス → 指紋） */
  managedFiles: Record<string, string>;
  /** 利用者が消したままにした管理ファイルのパス */
  removedFiles: string[];
}

/** 新しいハーネスで作った config.yaml の中身を、更新の記録に直す */
export function toUpdateConfigText(createdText: string, input: UpdateConfigInput): string {
  const created = parseYaml(createdText) as Record<string, unknown>;
  const sorted = (paths: string[]): string[] => [...paths].sort((a, b) => (a < b ? -1 : 1));
  const managedFiles: Record<string, string> = {};
  for (const p of sorted(Object.keys(input.managedFiles))) {
    managedFiles[p] = input.managedFiles[p] as string;
  }
  const doc: Record<string, unknown> = {
    harness_version: created["harness_version"],
    generated_on: input.generatedOn,
    updated_on: input.updatedOn,
    mode: "update",
  };
  for (const [key, value] of Object.entries(created)) {
    if (key in doc) continue;
    if (key === "managed_files") {
      doc[key] = managedFiles;
      if (input.removedFiles.length > 0) doc["removed_files"] = sorted(input.removedFiles);
    } else {
      doc[key] = value;
    }
  }
  return HEADER + stringifyYaml(doc, { lineWidth: 0 });
}
