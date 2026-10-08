import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** リポジトリ直下の実際のひな形（templates/） */
export const realTemplatesDir = path.resolve(here, "../../templates");

/** テスト用の小さなひな形（架空の値だけ） */
export const fixturesDir = path.join(here, "fixtures", "templates");

const tmpDirs: string[] = [];

/** 一時フォルダの中に、パス→中身 のひな形を作って、そのフォルダを返す。 */
export function makeTemplates(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "harness-test-templates-"));
  tmpDirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, ...rel.split("/"));
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content, "utf8");
  }
  return dir;
}

export function cleanupTemplates(): void {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

export const AGENT_ROLES = [
  "planner",
  "plan_reviewer",
  "implementer",
  "test_writer",
  "code_reviewer",
  "quality_checker",
  "prototyper",
  "doc_writer",
] as const;

/** 実際の templates/ のエージェント：ひな形のファイル名 → Codex の name */
export const REAL_AGENTS: Record<string, string> = {
  "code-reviewer": "code_reviewer",
  "doc-writer": "doc_writer",
  implementer: "implementer",
  planner: "planner",
  "plan-reviewer": "plan_reviewer",
  prototyper: "prototyper",
  "quality-checker": "quality_checker",
  "test-writer": "test_writer",
};

export const REAL_SKILLS = [
  "backend",
  "env-deploy",
  "error-api",
  "frontend",
  "implementation-process",
  "knowledge",
  "review",
  "security",
  "testing",
];

/** 実際の templates/ に出てくる名前（{{...}}）すべてに、架空の値を入れた表 */
export function fakeValues(): Record<string, string> {
  const values: Record<string, string> = {
    app_name: "testapp_001",
    claude_model_orchestrator: "claude-model-orchestrator-test",
    asvs_level: "2",
    e2e_port: "4999",
    compatibility_date: "2026-01-01",
  };
  for (const role of AGENT_ROLES) {
    values[`claude_model_${role}`] = `claude-model-${role}-test`;
    values[`codex_model_${role}`] = `codex-model-${role}-test`;
    values[`codex_effort_${role}`] = "medium";
  }
  const others = [
    "pentest_requirement",
    "transaction_notes",
    "secrets_table",
    "postgres_migration_notes",
    "mutation_targets",
    "knowledge_index",
    "error_handler",
    "dev_env_notes",
    "database",
    "data_access_skill",
    "data_access_library",
    "check_command",
    "batch_notes",
    "backup_notes",
    "auth_method",
    "allowed_origins",
    "data_access_guide",
    "data_access_rule_row",
    "example_skills",
    // リポジトリの置き場所で変わる値（#61）
    "issue_and_pr",
    "issue_or_pr_record",
    "pr_equivalent",
    "issue_record_place",
    "knowledge_record_place",
    "test_list_place",
    "change_review_place",
    "merged_unit",
    "implement_deliverable",
    "feedback_proposal_ref",
    "harness_proposal_way",
    "feedback_instruction",
    "secret_write_places",
    "secret_put_commands",
    "remote_ops_caution",
    "done_link_check",
    "workflow_issue_step",
    "workflow_review_steps",
    "workflow_main_rules",
    "commit_merge_step",
    "prev_merged_check",
    "dependency_update_row",
    "security_dependabot_section",
    "requirements_doc",
    "tech_stack_doc",
    "design_overview_doc",
    "design_feature_doc",
    "design_doc_dir",
    "adr_dir",
    "testing_docs_dir",
    "prototype_dir",
    "api_spec_doc",
    "schemathesis_doc",
    "api_spec_test_rule",
    "backend_examples_note",
    "frontend_examples_note",
    "env_check_how",
    "rules_apply_step",
    // 既存のプロジェクトへの導入（#15）で入れ替える値
    "rule_skills_backend",
    "rule_skills_frontend",
    "rule_skills_frontend_api",
    "rule_skills_logger",
    "rule_skills_testing",
    "rule_skills_quality",
    "project_rules_place",
    "env_missing_rule",
    "secrets_guide",
    "project_rules_section",
    "document_place_rows",
    "frontend_example_skills",
    "test_env_notes",
    "test_docs_rule",
    "check_command_detail",
    "security_procedure_ref",
    "schemathesis_rule",
    "pentest_plan_place",
    "test_isolation_notes",
    "test_docs_paren",
    "quality_checker_command_step",
    // 技術プロファイルの Skill の、生成したアプリ専用の箇所（#18）
    "profile_skill_note",
    "hono_parts_section",
    "hono_examples_intro",
    "drizzle_schema_places",
    "drizzle_migrate_commands",
    "drizzle_env_notes",
    "drizzle_examples_intro",
    "drizzle_example_tests",
    "frontend_state_examples_intro",
    "axios_client_rule",
    "axios_examples_intro",
    "logger_examples_intro",
    "quality_run_section",
    "quality_generated_rule",
    "hono_csrf_rule",
    "hono_csp_rule",
    "test_tools_console_rule",
    "test_tools_db_rule",
    "axios_unauthenticated_rule",
    "axios_error_shape",
    "logger_common_rule",
    "logger_audit_rule",
    "quality_nosemgrep_rule",
  ];
  for (const name of others) values[name] = `dummy-${name.replaceAll("_", "-")}`;
  return values;
}

export const LEFTOVER_NAME = /\{\{[a-z][a-z0-9_]*\}\}/;

/** fixtures のひな形のすべてのファイルを パス→中身 で返す（一部を足す・上書きして、別のひな形を作るため） */
export function fixtureFiles(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rel of readdirSync(fixturesDir, { recursive: true, encoding: "utf8" })) {
    const full = path.join(fixturesDir, rel);
    if (statSync(full).isFile()) out[rel.split(path.sep).join("/")] = readFileSync(full, "utf8");
  }
  return out;
}

/** buildAiOutputs が必須とするひな形（AGENTS.md・CLAUDE.md・skills/・ai-settings の2ファイル）。agents/ は含めない */
export function requiredTemplateFiles(): Record<string, string> {
  const all = fixtureFiles();
  const out: Record<string, string> = {};
  for (const [p, c] of Object.entries(all)) {
    if (!p.startsWith("agents/") && !p.startsWith("profiles/")) out[p] = c;
  }
  return out;
}
