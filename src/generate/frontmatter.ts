import { parse as parseYaml } from "yaml";
import { GenerateError } from "./errors.js";
import { normalizeNewlines } from "./template.js";

export type AgentTemplate = {
  /** 冒頭（YAML）を読んだもの。名前（{{...}}）は引用符つきの文字列としてそのまま入っている */
  head: Record<string, unknown>;
  /** 閉じの --- の行の次の行から、ファイルの終わりまで（そのまま） */
  body: string;
};

/** エージェントのひな形を、冒頭（YAML）と本文に分ける。 */
export function splitAgentTemplate(text: string, fileName: string): AgentTemplate {
  const normalized = normalizeNewlines(text);
  const match = /^---\n([\s\S]*?)\n---(?:\n([\s\S]*))?$/.exec(normalized);
  if (!match) {
    throw new GenerateError(`${fileName}：冒頭（---で囲んだ部分）がありません`);
  }
  let head: unknown;
  try {
    head = parseYaml(match[1] ?? "");
  } catch (e) {
    throw new GenerateError(`${fileName}：冒頭（YAML）を読めません：${(e as Error).message}`, {
      cause: e,
    });
  }
  if (typeof head !== "object" || head === null || Array.isArray(head)) {
    throw new GenerateError(`${fileName}：冒頭（YAML）が「項目: 値」の形ではありません`);
  }
  return { head: head as Record<string, unknown>, body: match[2] ?? "" };
}
