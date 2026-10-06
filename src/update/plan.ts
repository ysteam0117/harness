import { fingerprint } from "../generate/config.js";

export type FileState = { kind: "absent" } | { kind: "file"; text: string };

export interface NewFile {
  path: string;
  content: string;
  executable?: true;
}

export type Decision =
  | { kind: "replace"; path: string; file: NewFile }
  | { kind: "unchanged"; path: string; file: NewFile }
  | { kind: "conflict"; path: string; file: NewFile; current: string }
  | { kind: "missing"; path: string; file: NewFile }
  | { kind: "added"; path: string; file: NewFile }
  | { kind: "removed_kept"; path: string }
  | { kind: "obsolete"; path: string };

export interface PlanInput {
  /** 新しい組の、管理するファイル */
  files: NewFile[];
  /** 記録された指紋 */
  recorded: Readonly<Record<string, string>>;
  /** 消したままにしたパス */
  removed: readonly string[];
  /** 今のファイルの状態（新しい組のすべてのパス） */
  current: ReadonlyMap<string, FileState>;
}

/**
 * 管理するファイルごとの扱いを決める（純粋な関数。ディスクは見ない）。
 * 判定の順は新しい組のパスの順で、不要になったもの（obsolete）は最後にパスの順で並べる。
 */
export function planUpdate(input: PlanInput): Decision[] {
  const removed = new Set(input.removed);
  const decisions: Decision[] = [];
  const inNewSet = new Set<string>();
  for (const file of input.files) {
    inNewSet.add(file.path);
    const state = input.current.get(file.path) ?? { kind: "absent" };
    const recorded = input.recorded[file.path];
    if (state.kind === "absent") {
      if (removed.has(file.path)) decisions.push({ kind: "removed_kept", path: file.path });
      else if (recorded !== undefined) decisions.push({ kind: "missing", path: file.path, file });
      else decisions.push({ kind: "added", path: file.path, file });
      continue;
    }
    const now = fingerprint(state.text);
    if (now === fingerprint(file.content)) {
      decisions.push({ kind: "unchanged", path: file.path, file });
    } else if (recorded !== undefined && now === recorded) {
      decisions.push({ kind: "replace", path: file.path, file });
    } else {
      decisions.push({ kind: "conflict", path: file.path, file, current: state.text });
    }
  }
  for (const p of Object.keys(input.recorded).sort()) {
    if (!inNewSet.has(p)) decisions.push({ kind: "obsolete", path: p });
  }
  return decisions;
}
