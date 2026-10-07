import { fingerprint } from "../generate/config.js";
import type { FileState } from "../update/plan.js";
import type { AdoptFile } from "./build.js";

export type AdoptDecision =
  /** 文書（AGENTS.md・CLAUDE.md）：印で囲んで統合する。current が undefined なら、ファイルが無い */
  | { kind: "doc-merge"; path: string; body: string; current: string | undefined }
  /** 同じ名前のファイルが無い：追加する */
  | { kind: "add"; path: string; file: AdoptFile }
  /** 同じ名前で中身も同じ（改行の違いは無視）：書かない */
  | { kind: "same"; path: string; file: AdoptFile }
  /** 同じ名前で中身が違う：上書きせず、差分を見せて選ばせる */
  | { kind: "choose"; path: string; file: AdoptFile; current: string };

export interface AdoptPlanInput {
  /** 導入するファイル（この順に判定する） */
  files: readonly AdoptFile[];
  /** 今のファイルの状態（無いパスは、無いものとして扱う） */
  current: ReadonlyMap<string, FileState>;
}

/** ファイルごとの扱いを決める（純粋な関数。ディスクは見ない） */
export function planAdopt(input: AdoptPlanInput): AdoptDecision[] {
  return input.files.map((file): AdoptDecision => {
    const state = input.current.get(file.path) ?? { kind: "absent" };
    if (file.kind === "doc") {
      return {
        kind: "doc-merge",
        path: file.path,
        body: file.content,
        current: state.kind === "file" ? state.text : undefined,
      };
    }
    if (state.kind === "absent") return { kind: "add", path: file.path, file };
    if (fingerprint(state.text) === fingerprint(file.content)) {
      return { kind: "same", path: file.path, file };
    }
    return { kind: "choose", path: file.path, file, current: state.text };
  });
}
