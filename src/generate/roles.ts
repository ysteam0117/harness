import type { Ai } from "./adapter.js";
import { isPlainObject, readDataYaml } from "./data.js";
import { GenerateError } from "./errors.js";

export interface RoleModel {
  claude?: { model: string };
  codex?: { model: string; effort: string };
}

const DATA_FILE = "role-models.yaml";
const EFFORTS = ["minimal", "low", "medium", "high", "xhigh", "max", "ultra"];
/** 統括。Codex 側は、Orca連携が use で統括のAIが codex のときだけ出す（F-30） */
const ORCHESTRATOR = "orchestrator";

let cached: Record<string, RoleModel> | undefined;

function nonEmpty(value: unknown, where: string): string {
  if (typeof value !== "string" || value === "") {
    throw new GenerateError(`${where} は、空でない文字列で書いてください`);
  }
  return value;
}

/** data/role-models.yaml（役割 → モデル）を読んで検証する。役割は書いた順 */
export function loadRoleModels(): Record<string, RoleModel> {
  if (cached) return cached;
  const doc = readDataYaml(DATA_FILE);
  const roles = isPlainObject(doc) ? doc["roles"] : undefined;
  if (!isPlainObject(roles)) {
    throw new GenerateError(`data/${DATA_FILE}：「roles: {役割: ...}」の形で書いてください`);
  }
  const out: Record<string, RoleModel> = {};
  for (const [role, def] of Object.entries(roles)) {
    const at = `data/${DATA_FILE} の ${role}`;
    if (!/^[a-z][a-z0-9_]*$/.test(role)) {
      throw new GenerateError(`${at}：役割の名前は英小文字・数字・_ で書いてください`);
    }
    if (!isPlainObject(def)) throw new GenerateError(`${at}：「claude: ...」の形で書いてください`);
    for (const key of Object.keys(def)) {
      if (key !== "claude" && key !== "codex") {
        throw new GenerateError(`${at}：知らない項目 ${key} があります（claude・codex だけ）`);
      }
    }
    const model: RoleModel = {};
    const claude = def["claude"];
    if (!isPlainObject(claude)) {
      throw new GenerateError(`${at}：claude の model を書いてください`);
    }
    model.claude = { model: nonEmpty(claude["model"], `${at} の claude.model`) };
    const codex = def["codex"];
    if (!isPlainObject(codex)) {
      throw new GenerateError(`${at}：codex の model と effort を書いてください`);
    }
    const effort = nonEmpty(codex["effort"], `${at} の codex.effort`);
    if (!EFFORTS.includes(effort)) {
      throw new GenerateError(
        `${at}：codex.effort の ${effort} は使えません（${EFFORTS.join("・")}）`,
      );
    }
    model.codex = { model: nonEmpty(codex["model"], `${at} の codex.model`), effort };
    out[role] = model;
  }
  cached = out;
  return out;
}

/**
 * 選んだAIの分だけの、役割 → モデル。
 * 統括の Claude 側は Claude Code を選べば常に入る。統括の Codex 側は、
 * orca が use で orchestratorAi が codex のときだけ入る（F-30）。
 */
export function rolesFor(
  ais: readonly Ai[],
  orca: "none" | "use" = "none",
  orchestratorAi?: "claude" | "codex",
): Record<string, RoleModel> {
  const out: Record<string, RoleModel> = {};
  for (const [role, def] of Object.entries(loadRoleModels())) {
    const entry: RoleModel = {};
    if (ais.includes("claude") && def.claude) entry.claude = { ...def.claude };
    const codexAllowed = role !== ORCHESTRATOR || (orca === "use" && orchestratorAi === "codex");
    if (ais.includes("codex") && def.codex && codexAllowed) entry.codex = { ...def.codex };
    if (Object.keys(entry).length > 0) out[role] = entry;
  }
  return out;
}
