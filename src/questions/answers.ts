import { parse } from "yaml";
import {
  matchesCondition,
  questionDefinitions,
  validateValue,
  type QuestionDefinition,
} from "./definitions.js";

type YesNoUndecided = "no" | "yes" | "undecided";

/** 質問への回答（質問の id がキー。値は英字） */
export interface Answers {
  app_name: string;
  ais: ("claude" | "codex")[];
  project_type: "web";
  layers: "frontend_backend";
  visibility: "public" | "private";
  team_size: "solo" | "team";
  frontend: "react";
  backend: "hono";
  infra: "cloudflare";
  database: "d1" | "postgresql" | "none";
  postgres_provider?: "neon" | "supabase" | "other";
  data_access?: "drizzle";
  auth: "none" | "app" | "oidc" | "both";
  idp?: "google" | "microsoft" | "other";
  personal_data: "none" | "basic" | "sensitive" | "undecided";
  admin: YesNoUndecided;
  critical_ops: YesNoUndecided;
  critical_ops_kinds?: ("payment" | "publish" | "delete" | "permission")[];
  collaborative: YesNoUndecided;
  org_separation: YesNoUndecided;
  realtime: YesNoUndecided;
  availability: "tolerant" | "critical" | "undecided";
  file_upload: "no" | "yes";
  file_kinds?: ("image" | "video" | "document")[];
  check_location: "local" | "github_actions" | "both";
  version_policy: "verified" | "latest";
}

/** --answers の内容に問題があった。問題を1件ずつの日本語の文にして、まとめて持つ */
export class AnswersError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(`回答ファイルに問題があります：\n${errors.map((e) => `- ${e}`).join("\n")}`);
    this.name = "AnswersError";
    this.errors = errors;
  }
}

export interface ParsedAnswers {
  answers: Partial<Answers>;
  /** accepted_warnings に書かれた、承知した警告のルールの id */
  acceptedWarnings: string[];
}

const ACCEPTED_WARNINGS_KEY = "accepted_warnings";

/**
 * --answers の YAML を読んで検証する。書いた回答だけを返す（自動で決まる値は補わない）。
 * アプリ名の形はここでは確かめない（整合性チェックのルール9で示す）。
 */
export function parseAnswersYaml(
  text: string,
  definitions: readonly QuestionDefinition[] = questionDefinitions,
): ParsedAnswers {
  let doc: unknown;
  try {
    doc = parse(text);
  } catch (e) {
    throw new AnswersError([
      `YAML として読めません：${e instanceof Error ? e.message : String(e)}`,
    ]);
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    throw new AnswersError([
      "回答は「質問の id: 値」の形（連想配列）で書いてください。ファイルの先頭が連想配列ではありません",
    ]);
  }
  const raw = doc as Record<string, unknown>;
  const errors: string[] = [];
  const known = new Set(definitions.map((d) => d.id));

  for (const key of Object.keys(raw)) {
    if (key !== ACCEPTED_WARNINGS_KEY && !known.has(key)) {
      errors.push(`知らないキーです：${key}`);
    }
  }

  let acceptedWarnings: string[] = [];
  if (ACCEPTED_WARNINGS_KEY in raw) {
    const v = raw[ACCEPTED_WARNINGS_KEY];
    if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
      acceptedWarnings = v as string[];
    } else {
      errors.push(`${ACCEPTED_WARNINGS_KEY}：ルールの id の一覧（文字列の配列）で指定してください`);
    }
  }

  // 値の型・選択肢の確かめ。正しかったものだけを、条件の判定に使う
  const valid: Record<string, unknown> = {};
  for (const def of definitions) {
    if (!(def.id in raw)) continue;
    const message = validateValue(def, raw[def.id]);
    if (message) errors.push(`${def.id}：${message}`);
    else valid[def.id] = raw[def.id];
  }

  // 対話しない質問（質問A〜G）は、書かれていなければ既定値として条件を確かめる
  const effective: Record<string, unknown> = { ...valid };
  for (const def of definitions) {
    if (def.interactive === false && def.defaultValue !== undefined && !(def.id in effective)) {
      effective[def.id] = def.defaultValue;
    }
  }

  for (const def of definitions) {
    if (!(def.id in valid)) continue;
    // 条件に合わない質問への回答
    if (def.when && !matchesCondition(def.when, effective) && def.when.id in effective) {
      const written = def.when.id in valid;
      errors.push(
        written
          ? `${def.id}：この質問は、${def.when.id} の回答によって聞かない質問のため、回答を書けません`
          : `${def.id}：${def.id} を書く場合は、条件となる ${def.when.id} も書く必要があります（${def.when.id} が書かれていないため、既定値の「${String(effective[def.when.id])}」として扱われ、条件に合いません）`,
      );
      continue;
    }
    // 自動で決まる値と違う値
    if (
      def.forced &&
      matchesCondition(def.forced.when, valid) &&
      valid[def.id] !== def.forced.value
    ) {
      errors.push(
        `${def.id}：${def.forced.when.id} の回答により「${def.forced.value}」に決まるため、別の値は書けません`,
      );
    }
  }

  if (errors.length > 0) throw new AnswersError(errors);
  return { answers: valid as Partial<Answers>, acceptedWarnings };
}
