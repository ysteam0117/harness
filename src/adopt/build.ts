import type { Answers } from "../questions/answers.js";
import { readDataYaml } from "../generate/data.js";
import { GenerateError } from "../generate/errors.js";
import { judge } from "../generate/judgment.js";
import { selectKnowledge } from "../generate/knowledge.js";
import { checkOutputPaths } from "../generate/paths.js";
import { buildOutputs } from "../generate/plan.js";
import { isManagedPath } from "../generate/project.js";
import { findTemplatesDir } from "../generate/templates-dir.js";
import { buildValues, chooseValues, parseValueDefinitions } from "../generate/values.js";

/** 導入するファイル。AGENTS.md・CLAUDE.md は doc（content は、印で囲む本文だけ）、それ以外は file（content は、ファイル全体） */
export interface AdoptFile {
  /** "/" 区切りの相対パス */
  path: string;
  /** 改行は LF */
  content: string;
  kind: "doc" | "file";
}

export interface BuildAdoptInput {
  /** 完全な回答（自動で決まる値・未定を含む） */
  answers: Answers;
  /** 既定は findTemplatesDir() */
  templatesDir?: string;
  /** 既定はハーネスの knowledge/ */
  knowledgeDir?: string;
}

const ADOPT_VALUES_FILE = "adopt-values.yaml";

/** 印で囲んで、既存の文書に統合するファイル */
const DOC_PATHS = ["AGENTS.md", "CLAUDE.md"];

/**
 * 導入先に置くファイル（AI 向けのものだけ）をメモリ上で組み立てる。ディスクには書かない。
 * AGENTS.md・CLAUDE.md・共通の Skill（知見の写しを含む）・エージェントの定義・AI の権限の設定。
 * 技術プロファイルの Skill・コード・文書・スクリプト・CI は含めない。
 * 生成したアプリにだけあるコマンド・文書を書かないよう、data/adopt-values.yaml の値で入れ替える。
 * パスの順に並べ、同じ入力なら同じ結果になる。誤りは GenerateError。
 */
export function buildAdoptFiles(input: BuildAdoptInput): AdoptFile[] {
  const { answers } = input;
  const templatesDir = input.templatesDir ?? findTemplatesDir();
  const judgment = judge(answers);
  const knowledge = selectKnowledge(answers, {
    ...(input.knowledgeDir !== undefined ? { knowledgeDir: input.knowledgeDir } : {}),
  });
  const values = buildValues({ answers, judgment, knowledge });

  const label = `data/${ADOPT_VALUES_FILE}`;
  const overrides = chooseValues(
    parseValueDefinitions(readDataYaml(ADOPT_VALUES_FILE), label),
    answers,
    label,
    true,
  );
  for (const [name, value] of Object.entries(overrides)) {
    if (!(name in values)) {
      throw new GenerateError(
        `${label} の ${name}：data/template-values.yaml にない名前は、入れ替えられません（書き間違いの可能性）`,
      );
    }
    values[name] = value;
  }

  // 技術プロファイルは使わない（profiles を空にする）
  const built = buildOutputs({ templatesDir, ais: answers.ais, profiles: [], values, answers });
  const outputs = built.files.map((f) => ({ path: f.path, content: f.content }));

  // 知見の写し：Skill「知見」の references/（選んだAIごと）
  const skillRoots = [
    ...(answers.ais.includes("claude") ? [".claude/skills"] : []),
    ...(answers.ais.includes("codex") ? [".agents/skills"] : []),
  ];
  for (const root of skillRoots) {
    for (const entry of knowledge) {
      outputs.push({
        path: `${root}/knowledge/references/${entry.source}`,
        content: entry.content,
      });
    }
  }
  checkOutputPaths(outputs.map((f) => f.path));

  const files = outputs
    .map((f): AdoptFile => {
      if (!isManagedPath(f.path)) {
        throw new GenerateError(
          `導入するファイル ${f.path} が、管理するファイルの範囲にありません`,
        );
      }
      // 文書は、印で囲む本文だけ（末尾の改行は、印の行の改行が受け持つ）
      return DOC_PATHS.includes(f.path)
        ? { path: f.path, content: f.content.replace(/\n+$/, ""), kind: "doc" }
        : { ...f, kind: "file" };
    })
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return files;
}
