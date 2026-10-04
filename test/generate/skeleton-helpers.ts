// #56 生成するプロジェクトの「動くアプリの土台」のテスト共通の道具。メモリ上（buildProject）だけで確かめる。
//
// 想定する型（実装の役割はこの形に合わせる）
//   buildProject(input): { files: ProjectFile[] }   既存（src/generate/project.ts）。#56 で出るファイルが増える
//   回答は completeAnswers（project-helpers.ts）で作る。app_name は testapp-001（架空）

import { parse as parseYaml } from "yaml";
import { buildProject, type ProjectFile } from "../../src/generate/project.js";
import { contentOf, pathsOf, projectInput } from "./project-helpers.js";

export type Auth = "none" | "app" | "oidc" | "both";
export type Database = "d1" | "postgresql" | "none";

export const APP_NAME = "testapp-001";

export interface Combo {
  auth: Auth;
  database: Database;
  upload: boolean;
  /** テスト名に使う短い名前 */
  label: string;
}

/**
 * 有効な組み合わせだけ：認証 4 通り × DB 3 通り × アップロードあり・なし のうち、
 * 「DB なし＋独自認証（app・both）」「DB なし＋アップロード」は整合性チェックでエラーになる（別のテストで確かめる）ため除く。
 */
export function validCombos(): Combo[] {
  const out: Combo[] = [];
  for (const auth of ["none", "app", "oidc", "both"] as const) {
    for (const database of ["d1", "postgresql", "none"] as const) {
      for (const upload of [false, true]) {
        if (database === "none" && (auth === "app" || auth === "both")) continue;
        if (database === "none" && upload) continue;
        out.push({
          auth,
          database,
          upload,
          label: `auth=${auth}・db=${database}・upload=${upload ? "あり" : "なし"}`,
        });
      }
    }
  }
  return out;
}

/** 組み合わせの回答（上書き） */
export function answersOver(c: Combo): Record<string, unknown> {
  return {
    database: c.database,
    ...(c.database === "postgresql" ? { postgres_provider: "neon" } : {}),
    auth: c.auth,
    ...(c.auth === "oidc" || c.auth === "both" ? { idp: "google" } : {}),
    file_upload: c.upload ? "yes" : "no",
    ...(c.upload ? { file_kinds: ["image"] } : {}),
  };
}

const cache = new Map<string, Promise<ProjectFile[]>>();

/** 組み合わせの生成の結果（同じ組み合わせは1回だけ作る） */
export function generated(c: Combo): Promise<ProjectFile[]> {
  const key = c.label;
  let hit = cache.get(key);
  if (!hit) {
    hit = projectInput(answersOver(c)).then((input) => buildProject(input).files);
    cache.set(key, hit);
  }
  return hit;
}

export { contentOf, pathsOf };

/** wrangler.jsonc：先頭の「//」の行だけがコメントで、残りは JSON として読める */
export function parseWranglerJsonc(text: string): Record<string, unknown> {
  const lines = text.split("\n");
  while (lines[0]?.startsWith("//")) lines.shift();
  return JSON.parse(lines.join("\n")) as Record<string, unknown>;
}

/** .env.example の「名前=値」（コメント・空行は除く）。名前 → 値 */
export function parseEnvExample(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

export interface ComposeService {
  image?: string;
  container_name?: string;
  command?: string | string[];
  environment?: Record<string, string> | string[];
  volumes?: string[];
  depends_on?: Record<string, { condition?: string }> | string[];
  healthcheck?: Record<string, unknown>;
  ports?: (string | number)[];
  [key: string]: unknown;
}

export interface Compose {
  name?: string;
  services: Record<string, ComposeService>;
  volumes?: Record<string, unknown>;
}

export function parseCompose(text: string): Compose {
  return parseYaml(text) as Compose;
}

/** docker-compose.yml で ${VAR}・${VAR:-既定} と書かれた変数の名前 */
export function composeVariables(text: string): string[] {
  const names = new Set<string>();
  for (const m of text.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)/g)) names.add(m[1] as string);
  return [...names];
}
