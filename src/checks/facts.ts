import path from "node:path";
import type { Answers } from "../questions/answers.js";
import { validateAppName } from "../questions/app-name.js";
import type { Facts } from "./rules.js";
import { isNonEmptyDir as defaultIsNonEmptyDir } from "./target-dir.js";
import { checkTools as defaultCheckTools, type ToolStatus } from "./tools.js";

export interface FactsDeps {
  /** 生成先は path.join(cwd, app_name) */
  cwd: string;
  checkTools?: () => Promise<ToolStatus[]>;
  isNonEmptyDir?: (dir: string) => Promise<boolean>;
  /** #33 が渡す。既定は false */
  versionsNewerThanVerified?: boolean;
}

function describeTool(t: ToolStatus): string | undefined {
  switch (t.state) {
    case "ok":
      return undefined;
    case "missing":
      return `${t.name}：見つかりません。${t.guide ?? ""}`.trim();
    case "outdated":
      return `${t.name}：バージョンが古いです（${t.version ?? "不明"}）。${t.guide ?? ""}`.trim();
    case "unknown":
      return `${t.name}：確かめられませんでした（${t.detail ?? "理由は不明です"}）`;
  }
}

/** 回答以外の事実（バージョン・手元の道具・生成先）を集める */
export async function collectFacts(answers: Partial<Answers>, deps: FactsDeps): Promise<Facts> {
  const appName = answers.app_name;
  const invalid = typeof appName !== "string" || validateAppName(appName) !== undefined;
  const tools = await (deps.checkTools ?? defaultCheckTools)();
  const missingTools = tools.map(describeTool).filter((s): s is string => s !== undefined);
  // 不正なアプリ名では、生成先を調べない（不正な名前でファイルを操作しない）
  const targetDirNotEmpty = invalid
    ? false
    : await (deps.isNonEmptyDir ?? defaultIsNonEmptyDir)(path.join(deps.cwd, appName));
  return {
    versions_newer_than_verified: deps.versionsNewerThanVerified ?? false,
    missing_tools: missingTools,
    target_dir_not_empty: targetDirNotEmpty,
    invalid_app_name: invalid,
  };
}
