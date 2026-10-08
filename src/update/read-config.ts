import semver from "semver";
import { parse, stringify } from "yaml";
import type { AcceptedWarning } from "../checks/review.js";
import type { SecretScanRecord } from "../generate/config.js";
import { GenerateError } from "../generate/errors.js";
import { isManagedPath } from "../generate/project.js";
import { checkRelative } from "../generate/write.js";
import { AnswersError, parseAnswersYaml, type Answers } from "../questions/answers.js";
import type { VersionEntry } from "../versions/choose.js";
import { compareWithVerified } from "../versions/select.js";

/** .harness/config.yaml を読めない・内容に問題がある */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/** 記録された config.yaml のうち、更新に使うもの */
export interface RecordedConfig {
  /** 作り方：create（harness create）・update（harness update の後）・adopt（harness adopt）。記録が無ければ create */
  mode: ConfigMode;
  harnessVersion: string;
  generatedOn: string;
  updatedOn?: string;
  answers: Partial<Answers>;
  acceptedWarnings: AcceptedWarning[];
  versions: VersionEntry[];
  /** 管理するファイルのパス → 指紋（管理の対象にあるものだけ） */
  managedFiles: Record<string, string>;
  /** 利用者が消したままにした管理ファイルのパス */
  removedFiles: string[];
  /** 管理の対象でなくなっていたため、無視した記録のパス */
  ignored: string[];
  /** 印（harness:begin〜harness:end）で囲んだ文書のパス。managedFiles の指紋は、印の中の本文の指紋（adopt のときだけ） */
  markedFiles: string[];
  /** 導入のときの秘密情報の確認の記録（harness adopt のときだけ。形が違えば無い） */
  secretScan?: SecretScanRecord;
}

export type ConfigMode = "create" | "update" | "adopt";
const MODES: readonly string[] = ["create", "update", "adopt"];

const FILE = ".harness/config.yaml";

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function need<T>(
  raw: Record<string, unknown>,
  key: string,
  ok: (v: unknown) => v is T,
  form: string,
): T {
  if (!(key in raw)) throw new ConfigError(`${FILE} に ${key} がありません`);
  const v = raw[key];
  if (!ok(v)) throw new ConfigError(`${FILE} の ${key} が誤っています（${form}で書いてください）`);
  return v;
}

const isString = (v: unknown): v is string => typeof v === "string" && v !== "";
const isRecord = (v: unknown): v is Record<string, unknown> => record(v) !== undefined;

function relativePath(p: string, where: string): void {
  try {
    checkRelative(p);
  } catch (e) {
    if (e instanceof GenerateError) {
      throw new ConfigError(`${FILE} の ${where} に、使えないパスがあります：${e.message}`);
    }
    throw e;
  }
}

function toEntry(raw: unknown, index: number): VersionEntry {
  const v = record(raw);
  const at = `versions の ${String(index + 1)} 番目`;
  if (
    v === undefined ||
    !isString(v["name"]) ||
    !isString(v["version"]) ||
    typeof v["reason"] !== "string"
  ) {
    throw new ConfigError(`${FILE} の ${at} が誤っています（name・version・reason が必要です）`);
  }
  const verified = typeof v["verified"] === "string" ? v["verified"] : null;
  const latest = typeof v["latest_stable"] === "string" ? v["latest_stable"] : null;
  let newer = false;
  let major = false;
  if (verified !== null && semver.valid(verified) !== null && semver.valid(v["version"]) !== null) {
    const c = compareWithVerified(verified, v["version"]);
    newer = c.kind === "newer";
    major = c.majorDiffers;
  }
  return {
    name: v["name"],
    version: v["version"],
    reason: v["reason"],
    surveyedOn: typeof v["surveyed_on"] === "string" ? v["surveyed_on"] : "",
    latestStable: latest,
    latestStatus: latest !== null ? "found" : "failed",
    verified,
    newerThanVerified: newer,
    majorDiffers: major,
  };
}

/** config.yaml の中身を読んで検証する。問題があれば ConfigError */
export function parseConfig(text: string): RecordedConfig {
  let doc: unknown;
  try {
    doc = parse(text);
  } catch (e) {
    throw new ConfigError(
      `${FILE} を YAML として読めません：${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const raw = record(doc);
  if (raw === undefined) throw new ConfigError(`${FILE} の先頭が連想配列ではありません`);

  const harnessVersion = need(raw, "harness_version", isString, "文字列");
  if (semver.valid(harnessVersion) === null) {
    throw new ConfigError(
      `${FILE} の harness_version が、バージョンの形ではありません：${harnessVersion}`,
    );
  }
  const mode = "mode" in raw ? raw["mode"] : "create";
  if (typeof mode !== "string" || !MODES.includes(mode)) {
    throw new ConfigError(
      `${FILE} の mode が誤っています（${MODES.join("・")} のどれかで書いてください）`,
    );
  }
  const generatedOn = need(raw, "generated_on", isString, "文字列");
  const updatedOn = typeof raw["updated_on"] === "string" ? raw["updated_on"] : undefined;

  const answersRaw = need(raw, "answers", isRecord, "連想配列");
  let answers: Partial<Answers>;
  try {
    answers = parseAnswersYaml(stringify(answersRaw)).answers;
  } catch (e) {
    if (e instanceof AnswersError) {
      throw new ConfigError(
        `${FILE} の answers に問題があります：\n${e.errors.map((m) => `- ${m}`).join("\n")}`,
      );
    }
    throw e;
  }

  const warningsRaw = "accepted_warnings" in raw ? raw["accepted_warnings"] : [];
  if (!Array.isArray(warningsRaw)) {
    throw new ConfigError(`${FILE} の accepted_warnings が誤っています（一覧で書いてください）`);
  }
  const acceptedWarnings = warningsRaw.map((w, i): AcceptedWarning => {
    const r = record(w);
    if (r === undefined || !isString(r["id"])) {
      throw new ConfigError(
        `${FILE} の accepted_warnings の ${String(i + 1)} 番目に id がありません`,
      );
    }
    return {
      id: r["id"],
      message: typeof r["message"] === "string" ? r["message"] : "",
      reason: typeof r["reason"] === "string" ? r["reason"] : "",
    };
  });

  const versionsRaw = need(raw, "versions", Array.isArray, "一覧");
  const versions = versionsRaw.map((v, i) => toEntry(v, i));

  const managedRaw = need(raw, "managed_files", isRecord, "連想配列");
  const managedFiles: Record<string, string> = {};
  const ignored: string[] = [];
  for (const [p, fp] of Object.entries(managedRaw)) {
    relativePath(p, "managed_files");
    if (typeof fp !== "string" || !/^[0-9a-f]{64}$/.test(fp)) {
      throw new ConfigError(
        `${FILE} の managed_files の ${p} の指紋が誤っています（64 桁の16進で書いてください）`,
      );
    }
    // 管理の対象でないパス（プロジェクトのもの）は、更新の対象にしない
    if (isManagedPath(p)) managedFiles[p] = fp;
    else ignored.push(p);
  }

  const removedRaw = "removed_files" in raw ? raw["removed_files"] : [];
  if (!Array.isArray(removedRaw) || !removedRaw.every((p) => typeof p === "string")) {
    throw new ConfigError(`${FILE} の removed_files が誤っています（パスの一覧で書いてください）`);
  }
  const removedFiles: string[] = [];
  for (const p of removedRaw as string[]) {
    relativePath(p, "removed_files");
    if (isManagedPath(p)) removedFiles.push(p);
    else ignored.push(p);
  }

  const markedRaw = "marked_files" in raw ? raw["marked_files"] : [];
  if (!Array.isArray(markedRaw) || !markedRaw.every((p) => typeof p === "string")) {
    throw new ConfigError(`${FILE} の marked_files が誤っています（パスの一覧で書いてください）`);
  }
  const markedFiles: string[] = [];
  for (const p of markedRaw as string[]) {
    relativePath(p, "marked_files");
    // 管理するファイルの記録にあるものだけ（記録が無ければ、比べる指紋が無い）
    if (p in managedFiles) markedFiles.push(p);
  }

  const secretScan = readSecretScan(raw["secret_scan"]);

  return {
    mode: mode as ConfigMode,
    harnessVersion,
    generatedOn,
    ...(updatedOn !== undefined ? { updatedOn } : {}),
    answers,
    acceptedWarnings,
    versions,
    managedFiles,
    removedFiles,
    ignored,
    markedFiles,
    ...(secretScan !== undefined ? { secretScan } : {}),
  };
}

/** secret_scan の欄。形が正しいものだけ読む（誤っていても更新は止めない） */
function readSecretScan(value: unknown): SecretScanRecord | undefined {
  const r = record(value);
  if (r === undefined || typeof r["checked_on"] !== "string") return undefined;
  if (r["status"] === "skipped") return { status: "skipped", checkedOn: r["checked_on"] };
  if (
    r["status"] === "passed" &&
    (r["scope"] === "history+worktree" || r["scope"] === "worktree")
  ) {
    return { status: "passed", scope: r["scope"], checkedOn: r["checked_on"] };
  }
  return undefined;
}
