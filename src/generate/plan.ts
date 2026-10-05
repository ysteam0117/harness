import { readFileSync } from "node:fs";
import path from "node:path";
import { buildAiOutputs, type Ai, type OutputFile } from "./adapter.js";
import { stripHarnessComments } from "./comments.js";
import { GenerateError } from "./errors.js";
import { checkOutputPaths } from "./paths.js";
import type { Answers } from "../questions/answers.js";
import { mergePackageJson, resolveProfiles, selectProfileFiles } from "./profile.js";
import { expandExamples, normalizeNewlines, renderTemplate } from "./template.js";

export type BuildOutputsInput = {
  templatesDir: string;
  ais: Ai[];
  /** "<分類>/<id>" の一覧。requires の不足はエラー（自動では足さない） */
  profiles: string[];
  /** 名前 → 値 */
  values: Record<string, string>;
  /** files_when・package_json_when の条件に使う回答（既定は {}。何も合わない） */
  answers?: Partial<Answers>;
};

export type BuildOutputsResult = {
  files: OutputFile[];
  packageJson: Record<string, unknown>;
};

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * 出力するファイルの一覧（出力先の相対パスと中身）をメモリ上で作る。ディスクには書かない。
 * パスの順に並べ、同じ入力なら同じ結果になる。
 */
export function buildOutputs(input: BuildOutputsInput): BuildOutputsResult {
  const { templatesDir, values } = input;
  const answers = input.answers ?? {};
  const profiles = resolveProfiles(templatesDir, input.profiles);
  const sortedProfiles = [...profiles].sort((a, b) => compare(a.key, b.key));

  const outputs: OutputFile[] = buildAiOutputs({
    templatesDir,
    ais: input.ais,
    profiles,
    values,
  });
  for (const profile of sortedProfiles) {
    for (const file of selectProfileFiles(profile, answers)) {
      const rel = `profiles/${profile.key}/${file.source}`;
      let text: string;
      try {
        text = readFileSync(path.join(profile.dir, ...file.source.split("/")), "utf8");
      } catch (e) {
        throw new GenerateError(`${rel} を読めません`, { cause: e });
      }
      const content = renderTemplate(stripHarnessComments(normalizeNewlines(text), rel), values, {
        templatesDir,
        fileName: rel,
      });
      outputs.push({ path: file.destination, content });
    }
  }
  // AI向けの出力とプロファイルの files をまとめて、出力先の重なりを1か所で調べる
  checkOutputPaths(outputs.map((f) => f.path));

  // Skill の {{example:<出力先のパス>#<名前>}} は、ファイルの選択が終わった出力の一覧から差し込む（F-24）。
  // 出力の一覧にないファイルの例は差し込めない（出さない通りの例が、Skill に残らないようにする）
  const examples = outputs.filter((f) => !f.path.endsWith("/SKILL.md"));
  for (const file of outputs) {
    if (file.path.endsWith("/SKILL.md")) {
      file.content = expandExamples(file.content, examples, file.path);
    }
  }

  const files = outputs.sort((a, b) => compare(a.path, b.path));
  return { files, packageJson: mergePackageJson(sortedProfiles, answers) };
}
