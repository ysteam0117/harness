// 結合のテスト：本物と同じ実行エンジン（workerd）のローカルの D1 に、マイグレーションを適用して、読み書きを確かめる。
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { createSampleUserRepository } from "./sample-user.repository";
import { withDatabase } from "./database";

const USERNAME = "testuser_repository_test";

afterEach(async () => {
  // このテストが足した行だけを、識別子で消す（C-05）
  await env.DB.prepare("DELETE FROM sample_users WHERE username = ?")
    .bind(USERNAME)
    .run();
});

describe("SampleUserRepository（D1）", () => {
  it("足した行を、一覧で読める", async () => {
    await withDatabase(env, async (db) => {
      const repository = createSampleUserRepository(db);
      await repository.add(USERNAME);
      expect(await repository.list()).toContainEqual({ username: USERNAME });
    });
  });

  it("同じユーザー名は、2回足せない", async () => {
    await withDatabase(env, async (db) => {
      const repository = createSampleUserRepository(db);
      await repository.add(USERNAME);
      await expect(repository.add(USERNAME)).rejects.toThrow();
    });
  });
});
