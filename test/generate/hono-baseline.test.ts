// #40：Hono の構成の生成結果は、backend による出し分けを入れる前と1バイトも変わらない。
// 変更前（出し分けを入れる前のコミット）のコードで、認証・DB・リポジトリの置き場所・ファイルのアップロードの組み合わせごとに
// 「パス・管理の別・中身の指紋」の一覧を作り、その sha256 を fixtures/hono-baseline.json に記録した。
// 値が合わなければ、スナップショットを更新せず、出し分けの条件・scripts の並び・packages の並びを直す。
// （成り立たない組み合わせ（認証ありで DB なし等）は、変更前から生成がエラーになるため、記録に含めない）
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { fingerprint } from "../../src/generate/config.js";
import { buildProject } from "../../src/generate/project.js";
import { cleanupProjectTmp, projectInput } from "./project-helpers.js";

afterEach(cleanupProjectTmp);

const baselineFile = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/hono-baseline.json",
);
const baseline = JSON.parse(readFileSync(baselineFile, "utf8")) as Record<
  string,
  { files: number; hash: string }
>;

const AUTHS: Record<string, Record<string, unknown>> = {
  default: {},
  none: { auth: "none", idp: undefined },
  app: { auth: "app", idp: undefined },
  oidc: { auth: "oidc", idp: "google" },
  both: { auth: "both", idp: "google" },
};
const DBS: Record<string, Record<string, unknown>> = {
  none: { database: "none" },
  d1: { database: "d1" },
  pg: { database: "postgresql", postgres_provider: "neon" },
};
const REPOS: Record<string, Record<string, unknown>> = {
  github: { repository: "github" },
  local: { repository: "local", visibility: "private", check_location: "local" },
};
const UPLOADS: Record<string, Record<string, unknown>> = {
  nofile: {},
  file: { file_upload: "yes", file_kinds: ["image"] },
};

describe("#40: Hono の生成結果は、出し分けを入れる前と同じ（組み合わせごとの指紋）", () => {
  const keys = Object.keys(baseline);

  it("記録した組み合わせは、認証・DB・リポジトリ・アップロードの組み合わせのうち、成り立つものすべて", () => {
    expect(keys.length).toBeGreaterThanOrEqual(40);
  });

  it.each(keys)("%s", async (key) => {
    const [auth, db, repo, upload] = key.split("_") as [string, string, string, string];
    const input = await projectInput({
      ...AUTHS[auth],
      ...DBS[db],
      ...REPOS[repo],
      ...UPLOADS[upload],
      version_policy: "verified",
    });
    const files = buildProject(input).files;
    const lines = files.map((f) => `${f.managed ? "M" : "P"} ${f.path} ${fingerprint(f.content)}`);
    expect({
      files: files.length,
      hash: createHash("sha256").update(lines.join("\n")).digest("hex"),
    }).toEqual(baseline[key]);
  });
});
