// adopt の出力に書いてはいけない、生成したアプリ専用のコマンド・文書・フォルダ構成（#15・#18 のテストで共有）
/** 生成したアプリにだけあるコマンド名 */
export const COMMANDS = [
  "env:check",
  "check:app",
  "npm run security",
  "docker:up",
  "docker:down",
  "dev:test",
  "db:migrate",
  "db:seed",
  "db:cleanup",
  "test:db",
  "merge:check",
];
/** 導入で作らない文書のパス・生成したアプリのフォルダ構成 */
export const DOCUMENTS = [
  "docs/project-rules.md",
  "docs/secrets.md",
  "docs/testing/",
  "docs/api/",
  "docs/requirements.md",
  "docs/design/",
  "docs/adr/",
  "docs/tech-stack.md",
  "docs/issues/",
  "docs/harness-feedback/",
  ".githooks",
  "prototype/",
  "backend/src/",
  "frontend/src/",
];

/** 導入しない部品の名前。プロファイルの Skill の「必須の指示」（MUST）で、これらを使わせてはいけない */
export const MUST_NOT_USE_PARTS = [
  "originCheck",
  "setUnauthenticatedHandler",
  "console-guard",
  "allowConsoleError",
  "security.ts",
  ".semgrep/",
  "nosemgrep",
  "vitest.config.ts",
  "apiClient",
  "validate(",
  "AppError",
  "handleError",
];
