import path from "node:path";
import { isPlainObject } from "../generate/data.js";
import { GenerateError } from "../generate/errors.js";
import type { UpdateFs } from "../update/fs.js";
import { isUtf8Text, readState } from "../update/state.js";

const PROJECT_SETTINGS = ".claude/settings.json";
const LOCAL_SETTINGS = ".claude/settings.local.json";
const USER_LABEL = "~/.claude/settings.json";
const UNREADABLE = "設定を確認できません。";
const INVALID_MODE = "承認モードを確認できません。";

function modeNotice(mode: unknown, userSettings: boolean): string | undefined {
  switch (mode) {
    case "acceptEdits":
      return "acceptEdits — ファイルの編集に加え、作業範囲内の一部の削除や移動も確認なしで実行できます。";
    case "auto": {
      const note = "auto — 一部の操作は、人の確認に代えて分類器が判定します。";
      return userSettings
        ? note
        : `${note} 端末には、この指定や利用者設定の defaultMode に代えて組み込み既定が使われる版があります。`;
    }
    case "bypassPermissions": {
      const note =
        "bypassPermissions — 人の確認を省く設定です。有効な場合は利用者が Manual に切り替えてください。";
      return userSettings
        ? note
        : `${note} この保存先の指定は端末の v2.1.257 以降で無効です。それより前の版では効くことがあります。`;
    }
    case undefined:
    case "default":
    case "manual":
    case "plan":
    case "dontAsk":
      return undefined;
    default:
      return INVALID_MODE;
  }
}

async function inspect(fs: UpdateFs, root: string, rel: string, userSettings = false) {
  let state;
  try {
    state = await readState(fs, root, rel);
  } catch (error) {
    if (!(error instanceof GenerateError)) throw error;
    return UNREADABLE;
  }
  if (state.kind === "absent") return undefined;
  if (!isUtf8Text(state)) return UNREADABLE;

  let config: unknown;
  try {
    config = JSON.parse(state.text.replace(/^\uFEFF/, ""));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return UNREADABLE;
  }
  if (!isPlainObject(config)) return INVALID_MODE;
  const permissions = config["permissions"];
  if (permissions === undefined) return undefined;
  if (!isPlainObject(permissions)) return INVALID_MODE;
  return modeNotice(permissions["defaultMode"], userSettings);
}

async function resolveHome(fs: UpdateFs, homeDirectory: () => string) {
  try {
    const home = homeDirectory();
    return path.isAbsolute(home) ? await fs.realpath(home) : undefined;
  } catch {
    // OS やファイル操作の例外には、利用者のパスが含まれることがある。
    return undefined;
  }
}

/** 保存された承認モードの診断。実行中のモードは判定せず、設定ファイルの原文や例外を転記しない。 */
export async function approvalSettingLines(
  fs: UpdateFs,
  root: string,
  homeDirectory: () => string,
): Promise<string[]> {
  const home = await resolveHome(fs, homeDirectory);
  const atHome = home !== undefined && path.relative(root, home) === "";
  const [local, project, user] = await Promise.all([
    inspect(fs, root, LOCAL_SETTINGS),
    atHome ? undefined : inspect(fs, root, PROJECT_SETTINGS),
    home === undefined ? UNREADABLE : inspect(fs, home, PROJECT_SETTINGS, true),
  ]);
  const lines = [
    "Claude Code の承認設定：",
    `  確認範囲は ${LOCAL_SETTINGS}・${PROJECT_SETTINGS}・${USER_LABEL} の permissions.defaultMode です。`,
    "  端末・VS Code では、版や条件によってモード未設定でも auto で始まります。起動時のモードは利用者が画面で確かめてください。",
    "  VS Code の初期モード設定や前回の選択は、この診断の対象外です。",
  ];
  for (const [label, notice] of [
    [LOCAL_SETTINGS, local],
    [PROJECT_SETTINGS, project],
    [USER_LABEL, user],
  ] as const) {
    if (notice !== undefined) lines.push(`  - ${label}：${notice}`);
  }
  return lines;
}
