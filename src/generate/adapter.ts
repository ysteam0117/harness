import { readdirSync, readFileSync, type Dirent } from "node:fs";
import path from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { stripHarnessComments, stripPreambleComments } from "./comments.js";
import { GenerateError } from "./errors.js";
import { checkOutputPaths } from "./paths.js";
import { splitAgentTemplate } from "./frontmatter.js";
import type { Profile } from "./profile.js";
import { normalizeNewlines, renderTemplate } from "./template.js";
import { toToml } from "./toml.js";

export type Ai = "claude" | "codex";
export type OutputFile = { path: string; content: string };

export type BuildAiOutputsInput = {
  templatesDir: string;
  ais: Ai[];
  profiles: Profile[];
  values: Record<string, string>;
};

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const AGENT_FIELDS = ["name", "description", "claude", "codex"];

function readText(file: string, label: string): string {
  try {
    return normalizeNewlines(readFileSync(file, "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      throw new GenerateError(`必須のひな形 ${label} がありません`, { cause: e });
    }
    throw new GenerateError(`${label} を読めません`, { cause: e });
  }
}

function listDir(dir: string, label: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      throw new GenerateError(`必須のひな形のフォルダ ${label} がありません`, { cause: e });
    }
    throw new GenerateError(`${label} を読めません`, { cause: e });
  }
}

function checkAis(ais: unknown): Set<Ai> {
  if (!Array.isArray(ais) || ais.length === 0) {
    throw new GenerateError("使うAIを1つ以上選んでください（claude・codex）");
  }
  const chosen = new Set<Ai>();
  for (const ai of ais) {
    if (ai !== "claude" && ai !== "codex") {
      throw new GenerateError(
        `知らないAI ${JSON.stringify(ai)} が選ばれています（claude・codex だけ）`,
      );
    }
    chosen.add(ai);
  }
  return chosen;
}

function stringEntries(value: unknown, where: string, label: string): [string, string][] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new GenerateError(`${where}：${label} がありません（「項目: 値」の形で書いてください）`);
  }
  const out: [string, string][] = [];
  for (const [k, v] of Object.entries(value)) {
    if (typeof v !== "string") {
      throw new GenerateError(`${where}：${label} の ${k} は文字列で書いてください`);
    }
    out.push([k, v]);
  }
  return out;
}

function buildAgents(
  templatesDir: string,
  chosen: Set<Ai>,
  values: Record<string, string>,
  add: (file: OutputFile) => void,
): void {
  const agentsDir = path.join(templatesDir, "agents");
  for (const entry of listDir(agentsDir, "agents/")) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const fileName = `agents/${entry.name}`;
    const { head, body } = splitAgentTemplate(
      readText(path.join(agentsDir, entry.name), fileName),
      fileName,
    );
    for (const field of Object.keys(head)) {
      if (!AGENT_FIELDS.includes(field)) {
        throw new GenerateError(`${fileName}：冒頭に知らない項目 ${field} があります`);
      }
    }
    const render = (text: string): string =>
      renderTemplate(text, values, { templatesDir, fileName });
    const commonName = head["name"];
    const commonDescription = head["description"];
    if (typeof commonName !== "string" || typeof commonDescription !== "string") {
      throw new GenerateError(`${fileName}：冒頭の name・description は文字列で書いてください`);
    }
    const renderedBody = render(stripPreambleComments(body, false));

    if (chosen.has("claude")) {
      const section = stringEntries(head["claude"], fileName, "冒頭の claude:");
      const out: Record<string, string> = {};
      for (const [k, v] of [
        ["name", commonName],
        ["description", commonDescription],
        ...section,
      ] as [string, string][]) {
        out[k] = render(v);
      }
      const yamlText = stringifyYaml(out, { lineWidth: 0 });
      add({
        path: `.claude/agents/${entry.name}`,
        content: `---\n${yamlText}---\n${renderedBody}`,
      });
    }
    if (chosen.has("codex")) {
      const section = stringEntries(head["codex"], fileName, "冒頭の codex:");
      const nameEntry = section.find(([k]) => k === "name");
      if (nameEntry === undefined || !NAME_RE.test(nameEntry[1])) {
        throw new GenerateError(
          `${fileName}：冒頭の codex: の中に、英数字・-・_ だけの name が必要です`,
        );
      }
      const rest = section.filter(([k]) => k !== "name");
      for (const [k] of rest) {
        if (k === "description" || k === "developer_instructions") {
          throw new GenerateError(`${fileName}：冒頭の codex: の中の ${k} は書けません`);
        }
      }
      const entries: [string, string][] = [
        ["name", nameEntry[1]],
        ["description", render(commonDescription)],
        ...rest.map(([k, v]): [string, string] => [k, render(v)]),
        ["developer_instructions", renderedBody],
      ];
      add({ path: `.codex/agents/${nameEntry[1]}.toml`, content: toToml(entries) });
    }
  }
}

/** AGENTS.md・CLAUDE.md・Skill・エージェントの定義・権限の設定を、選んだAIごとに出し分ける。 */
export function buildAiOutputs(input: BuildAiOutputsInput): OutputFile[] {
  const { templatesDir, profiles, values } = input;
  const chosen = checkAis(input.ais);
  const outputs: OutputFile[] = [];
  const add = (file: OutputFile): void => {
    outputs.push(file);
  };
  const render = (text: string, fileName: string): string =>
    renderTemplate(text, values, { templatesDir, fileName });
  // 必須のひな形がなければ readText がエラーにする（足りないファイル名を示す）
  const addRendered = (rel: string, outPath: string): void => {
    const text = stripHarnessComments(readText(path.join(templatesDir, rel), rel), rel);
    add({ path: outPath, content: render(text, rel) });
  };
  const addCopied = (rel: string, outPath: string): void => {
    add({ path: outPath, content: readText(path.join(templatesDir, rel), rel) });
  };

  addRendered("AGENTS.md", "AGENTS.md");
  if (chosen.has("claude")) {
    addRendered("CLAUDE.md", "CLAUDE.md");
    addCopied("ai-settings/claude-settings.json", ".claude/settings.json");
  }
  if (chosen.has("codex")) {
    // ファイルの先頭の「# もとになった共通仕様」の行だけを取り除く（ほかの行はそのまま）
    add({
      path: ".codex/rules/default.rules",
      content: render(
        readText(
          path.join(templatesDir, "ai-settings/codex-default.rules"),
          "ai-settings/codex-default.rules",
        ).replace(/^# もとになった共通仕様[^\n]*\n/u, ""),
        "ai-settings/codex-default.rules",
      ),
    });
  }

  const skills: { name: string; content: string }[] = [];
  for (const entry of listDir(path.join(templatesDir, "skills"), "skills/")) {
    if (!entry.isDirectory()) continue;
    const rel = `skills/${entry.name}/SKILL.md`;
    const text = readText(path.join(templatesDir, rel), rel);
    skills.push({ name: entry.name, content: render(stripHarnessComments(text, rel), rel) });
  }
  for (const profile of profiles) {
    const rel = `profiles/${profile.key}/SKILL.md`;
    const text = readText(path.join(profile.dir, "SKILL.md"), rel);
    skills.push({ name: profile.skillName, content: render(stripHarnessComments(text, rel), rel) });
  }
  for (const skill of skills) {
    if (chosen.has("claude")) {
      add({ path: `.claude/skills/${skill.name}/SKILL.md`, content: skill.content });
    }
    if (chosen.has("codex")) {
      add({ path: `.agents/skills/${skill.name}/SKILL.md`, content: skill.content });
    }
  }

  buildAgents(templatesDir, chosen, values, add);

  checkOutputPaths(outputs.map((f) => f.path));
  return outputs;
}
