import type { Answers } from "../questions/answers.js";
import { readDataYaml } from "../generate/data.js";
import { GenerateError } from "../generate/errors.js";
import { judge } from "../generate/judgment.js";
import { selectKnowledge } from "../generate/knowledge.js";
import { checkOutputPaths } from "../generate/paths.js";
import { buildOutputs } from "../generate/plan.js";
import { loadProfile, selectProfileFiles } from "../generate/profile.js";
import { isManagedPath } from "../generate/project.js";
import { findTemplatesDir } from "../generate/templates-dir.js";
import { buildValues, chooseValues, parseValueDefinitions } from "../generate/values.js";
import { harnessVersion } from "../generate/config.js";
import {
  BASELINE_SCRIPT_PATH,
  buildBaselineScript,
  buildHarnessCheck,
  HARNESS_CHECK_PATH,
  safeDirs,
} from "./ci.js";
import type { AppliedProfile } from "./detect.js";
import { applyProfileSkillValues, usableProfiles } from "./profiles.js";

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
  /**
   * 当てた技術プロファイル（判定の applied、または config に記録した profiles.applied）。既定は []（共通のルールだけ）。
   * 入れるのは、そのプロファイルの Skill だけ（コード・設定のファイルは入れない）。
   * 今のハーネスに無いプロファイル（と、それを requires しているもの）は、飛ばす（報告は usableProfiles で行う）
   */
  profiles?: readonly AppliedProfile[];
  /** Node.js のアプリのフォルダ（記録した判定の結果）。harness-check.yml の npm audit の対象。既定は []（job を出さない） */
  nodeDirs?: readonly string[];
}

/** AGENTS.md の「プロジェクト固有のルール」の節に足す1行（Node.js のアプリがあるとき）。印の文字列は書かない */
const BASELINE_RULE =
  "- 品質チェックの基準線：導入のときの Lint・型・書式の違反の件数は `.harness/baseline.json` に記録している。各アプリで依存を入れた（`npm ci`）あとに `node .harness/scripts/baseline-check.mjs` を実行して、件数が増えていないか確かめる。減ったら `--update` を付けて基準線を下げる。上げるのは、ADRに記録し、利用者の承認を得たときだけ";

const ADOPT_VALUES_FILE = "adopt-values.yaml";

/** 印で囲んで、既存の文書に統合するファイル */
const DOC_PATHS = ["AGENTS.md", "CLAUDE.md"];

/**
 * 導入先に置くファイル（AI 向けのものだけ）をメモリ上で組み立てる。ディスクには書かない。
 * AGENTS.md・CLAUDE.md・共通の Skill（知見の写しを含む）・エージェントの定義・AI の権限の設定。
 * 技術プロファイルは、当てたものの Skill だけを含める（コード・設定のファイルは含めない）。
 * 文書は含めない。CI は、GitHub で品質チェックを GitHub Actions で行うときだけ、harness-check.yml を含める。
 * Node.js のアプリがあるときは、基準線の確認のスクリプト（.harness/scripts/baseline-check.mjs）を含め、AGENTS.md に実行方法を1行足す（#21）。
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

  // 基準線の確認（#21）：Node.js のアプリがあるときだけ、AGENTS.md に実行方法を書く（手元で確かめられるように）
  const baselineDirs = safeDirs(input.nodeDirs ?? []);
  if (baselineDirs.length > 0) {
    values["project_rules_section"] = `${values["project_rules_section"] ?? ""}
${BASELINE_RULE}`;
  }

  // 当てたプロファイル：今のハーネスで使えるものだけ。Skill を AGENTS.md の表に書く
  const applied = usableProfiles(input.profiles ?? [], templatesDir).usable;
  const loaded = applied.map((a) => ({
    profile: loadProfile(templatesDir, a.profile),
    apps: a.apps,
  }));
  applyProfileSkillValues(values, loaded);

  let built: ReturnType<typeof buildOutputs>;
  try {
    built = buildOutputs({
      templatesDir,
      ais: answers.ais,
      profiles: loaded.map((l) => l.profile.key),
      values,
      answers,
    });
  } catch (e) {
    if (loaded.length === 0 || !(e instanceof GenerateError)) throw e;
    // 例：回答が database: none なのに、DB のプロファイルが当たった
    throw new GenerateError(
      `当てたプロファイル（${loaded.map((l) => l.profile.key).join("・")}）の Skill を組み立てられません：${e.message}。回答（database など）が、既存のアプリの技術と合っているか確かめてください`,
      { cause: e },
    );
  }
  // プロファイルの files（コード・設定）は入れない。Skill（SKILL.md）だけを残す
  const notWritten = new Set(
    loaded.flatMap((l) => selectProfileFiles(l.profile, answers).map((f) => f.destination)),
  );
  const outputs = built.files
    .filter((f) => !notWritten.has(f.path))
    .map((f) => ({ path: f.path, content: f.content }));

  // CI：GitHub で、品質チェックを GitHub Actions で行うとき
  if (
    answers.repository === "github" &&
    (answers.check_location === "github_actions" || answers.check_location === "both")
  ) {
    outputs.push({
      path: HARNESS_CHECK_PATH,
      content: buildHarnessCheck({ templatesDir, nodeDirs: input.nodeDirs ?? [] }),
    });
  }

  // 基準線の確認のスクリプト：Node.js のアプリがあるとき。確認の場所（手元・GitHub Actions）によらず置く
  if (baselineDirs.length > 0) {
    outputs.push({
      path: BASELINE_SCRIPT_PATH,
      content: buildBaselineScript({
        templatesDir,
        dirs: baselineDirs,
        harnessVersion: harnessVersion(),
      }),
    });
  }

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
