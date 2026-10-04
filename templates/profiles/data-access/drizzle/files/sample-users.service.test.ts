import { describe, expect, it } from "vitest";
import {
  DuplicateSampleUserError,
  type SampleUserRepository,
} from "../db/sample-user.repository";
import { addSampleUser, listSampleUsers } from "./sample-users.service";

// DB の代わりに、メモリ上の架空のデータを使う（DB につながる結合のテストは db/・routes/ のテストで行う）。
// 同じユーザー名の追加は、本物の Repository と同じく DuplicateSampleUserError で知らせる
function memoryRepository(names: string[] = []): SampleUserRepository {
  return {
    list: () => Promise.resolve(names.map((username) => ({ username }))),
    add: (username) => {
      if (names.includes(username)) {
        return Promise.reject(new DuplicateSampleUserError(username));
      }
      names.push(username);
      return Promise.resolve();
    },
  };
}

describe("サンプルの利用者の Service", () => {
  it("追加したユーザー名を、一覧で読める", async () => {
    const repository = memoryRepository();
    await addSampleUser(repository, "testuser_service_test");
    expect(await listSampleUsers(repository)).toEqual([
      { username: "testuser_service_test" },
    ]);
  });

  it("Repository が重複を知らせたら、CONFLICT にする", async () => {
    const repository = memoryRepository(["testuser_service_test"]);
    await expect(
      addSampleUser(repository, "testuser_service_test"),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("重複以外のエラーは、CONFLICT にせず、そのまま伝える", async () => {
    const repository: SampleUserRepository = {
      list: () => Promise.resolve([]),
      add: () => Promise.reject(new Error("接続できません")),
    };
    await expect(
      addSampleUser(repository, "testuser_service_test"),
    ).rejects.toThrow("接続できません");
  });
});
