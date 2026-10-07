import { createTwoFilesPatch } from "diff";
import { normalizeNewlines } from "../generate/template.js";
import type { FileState, NewFile } from "./plan.js";

const MAX_LINES = 200;

/** 今のファイルと新しい内容の差分（unified 形式）。改行の違いだけでは差分にしない。長いときは先頭だけ */
export function formatDiff(
  filePath: string,
  current: string,
  next: string,
  /** 長くて省くときに添える、全体の見方（既定は update 用：.harness-new に置く） */
  fullViewHint = `全体は ${filePath}.harness-new に置くと見られます`,
  /** 表示する行数の上限（既定は200行。Infinity で省かない） */
  maxLines = MAX_LINES,
): string {
  const patch = createTwoFilesPatch(
    `現在の ${filePath}`,
    `新しい内容（${filePath}）`,
    normalizeNewlines(current),
    normalizeNewlines(next),
    undefined,
    undefined,
    { context: 3 },
  );
  // 先頭の「Index:」「====」の行は省く
  const lines = patch.split("\n").filter((l) => !l.startsWith("Index: ") && !/^=+$/.test(l));
  if (lines.length <= maxLines) return lines.join("\n").trimEnd();
  const omitted = lines.length - maxLines;
  return `${lines.slice(0, maxLines).join("\n")}\n…（省略：あと ${String(omitted)} 行。${fullViewHint}）`;
}

const PACKAGE_SECTIONS = ["scripts", "dependencies", "devDependencies"] as const;

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** 管理しない設定ファイル（package.json・wrangler.jsonc）で、新しいハーネスが変える点。書かず、知らせるだけ */
export function settingChangeNotes(
  built: readonly NewFile[],
  current: ReadonlyMap<string, FileState>,
): string[] {
  const notes: string[] = [];
  for (const file of built) {
    if (file.path !== "package.json" && file.path !== "wrangler.jsonc") continue;
    const state = current.get(file.path) ?? { kind: "absent" };
    if (state.kind === "absent") {
      notes.push(`${file.path}：ファイルがありません（新しいハーネスのひな形にはあります）`);
      continue;
    }
    if (file.path === "wrangler.jsonc") {
      if (normalizeNewlines(state.text).trim() !== normalizeNewlines(file.content).trim()) {
        notes.push("wrangler.jsonc：新しいハーネスのひな形と内容が違います");
      }
      continue;
    }
    let now: Record<string, unknown>;
    try {
      now = asRecord(JSON.parse(state.text));
    } catch {
      notes.push("package.json：JSON として読めないため、新しいハーネスとの違いを確かめられません");
      continue;
    }
    const next = asRecord(JSON.parse(file.content));
    for (const section of PACKAGE_SECTIONS) {
      const have = asRecord(now[section]);
      for (const [name, value] of Object.entries(asRecord(next[section]))) {
        if (have[name] !== value) {
          const was = typeof have[name] === "string" ? (have[name] as string) : "なし";
          notes.push(
            `package.json：${section}.${name}（今：${was} → 新しいハーネス：${String(value)}）`,
          );
        }
      }
    }
  }
  return notes;
}
