// #60：統括の Codex 側（F-30）。orca が use で orchestrator_ai が codex のときだけ、roles と展開値に出る
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { loadRoleModels, rolesFor } from "../../src/generate/roles.js";
import { buildProject } from "../../src/generate/project.js";
import { buildValues } from "../../src/generate/values.js";
import { cleanupProjectTmp, completeAnswers, projectInput } from "./project-helpers.js";

afterEach(cleanupProjectTmp);

const BOTH = ["claude", "codex"];
const cfgOf = (files: { path: string; content: string }[]) =>
  parse(files.find((f) => f.path === ".harness/config.yaml")?.content ?? "") as {
    answers: Record<string, unknown>;
    roles: Record<string, { claude?: unknown; codex?: { model: string; effort: string } }>;
  };

describe("#60 AC-2・AC-7: roles.ts", () => {
  it("#60 AC-7: role-models.yaml の orchestrator に Codex の分がある", () => {
    expect(loadRoleModels()["orchestrator"]?.codex).toEqual({
      model: "gpt-6-sol",
      effort: "medium",
    });
  });

  it("#60 AC-7: 連携なしでは、統括の Codex 側は出ない（Codex だけなら統括の役割ごと無い）", () => {
    expect(rolesFor(["codex"])["orchestrator"]).toBeUndefined();
    expect(rolesFor(BOTH as never)["orchestrator"]).toEqual({ claude: { model: "opus" } });
    expect(rolesFor(["claude"])["orchestrator"]).toEqual({ claude: { model: "opus" } });
  });

  it("#60 AC-7: use で統括が codex なら、統括の Codex 側が出る", () => {
    expect(rolesFor(["codex"], "use", "codex")["orchestrator"]).toEqual({
      codex: { model: "gpt-6-sol", effort: "medium" },
    });
    expect(rolesFor(BOTH as never, "use", "codex")["orchestrator"]?.codex?.effort).toBe("medium");
  });

  it("#60 AC-7: use でも統括が claude なら、統括は Claude 側だけ", () => {
    expect(rolesFor(BOTH as never, "use", "claude")["orchestrator"]).toEqual({
      claude: { model: "opus" },
    });
  });
});

describe("#60 AC-1・AC-3・AC-7: 生成物", () => {
  it("#60 AC-1・AC-7: use・両方・統括 codex なら、config に orca・orchestrator_ai・統括の Codex 側が記録される", async () => {
    const cfg = cfgOf(
      buildProject(await projectInput({ ais: BOTH, orca: "use", orchestrator_ai: "codex" })).files,
    );
    expect(cfg.answers["orca"]).toBe("use");
    expect(cfg.answers["orchestrator_ai"]).toBe("codex");
    expect(cfg.roles["orchestrator"]?.codex?.effort).toBe("medium");
    expect(cfg.roles["orchestrator"]?.codex?.model).toBe("gpt-6-sol");
  });

  it("#60 AC-3: none のときは、config の answers に orca も orchestrator_ai も出ない", async () => {
    const cfg = cfgOf(buildProject(await projectInput({ ais: BOTH })).files);
    expect("orca" in cfg.answers).toBe(false);
    expect("orchestrator_ai" in cfg.answers).toBe(false);
    expect(cfg.roles["orchestrator"]).toEqual({ claude: { model: "opus" } });
  });

  it("#60 AC-3: orca の none の明示と省略で、config.yaml がバイトまで同一", async () => {
    const withNone = buildProject(await projectInput({ ais: BOTH, orca: "none" })).files;
    const omitted = await projectInput({ ais: BOTH });
    delete (omitted.answers as unknown as Record<string, unknown>)["orca"];
    const without = buildProject(omitted).files;
    const get = (fs: { path: string; content: string }[]) =>
      fs.find((f) => f.path === ".harness/config.yaml")?.content;
    expect(get(withNone)).toBe(get(without));
  });

  it("#60 AC-3: use でも、config.yaml 以外のファイルの一覧と中身は none と同一（Orca向けの生成物は #62）", async () => {
    const none = buildProject(await projectInput({ ais: ["claude"] })).files;
    const use = buildProject(
      await projectInput({ ais: ["claude"], orca: "use", orchestrator_ai: "claude" }),
    ).files;
    const strip = (fs: { path: string; content: string }[]) =>
      fs.filter((f) => f.path !== ".harness/config.yaml");
    expect(strip(use)).toEqual(strip(none));
  });

  it("#60 AC-7: 展開値 codex_model_orchestrator は、use・Codex のときだけ入る", async () => {
    const use = buildValues({
      answers: await completeAnswers({ ais: BOTH, orca: "use", orchestrator_ai: "codex" }),
    });
    expect(use["codex_model_orchestrator"]).toBe("gpt-6-sol");
    expect(use["codex_effort_orchestrator"]).toBe("medium");
    const none = buildValues({ answers: await completeAnswers({ ais: BOTH }) });
    expect(none["codex_model_orchestrator"]).toBeUndefined();
    expect(none["claude_model_orchestrator"]).toBe("opus");
  });
});
