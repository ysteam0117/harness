// Service：サンプルの利用者の一覧と追加。HTTP（Hono）も DB のライブラリも知らない（C-03）。
import { AppError } from "../lib/app-error";
import {
  DuplicateSampleUserError,
  type SampleUser,
  type SampleUserRepository,
} from "../db/sample-user.repository";

/** Repository を使う間だけ DB につなぐ処理。Workers の入口（index.ts）が本物を渡し、テストが差し替える */
export type WithSampleUsers = <T>(
  env: Env,
  run: (repository: SampleUserRepository) => Promise<T>,
) => Promise<T>;

export async function listSampleUsers(
  repository: SampleUserRepository,
): Promise<SampleUser[]> {
  return repository.list();
}

/** 1件追加する。同じユーザー名がすでにあれば（Repository が知らせる）、CONFLICT（409）にする */
export async function addSampleUser(
  repository: SampleUserRepository,
  username: string,
): Promise<SampleUser> {
  try {
    await repository.add(username);
  } catch (error) {
    if (error instanceof DuplicateSampleUserError) {
      throw new AppError(
        "CONFLICT",
        "そのユーザー名はすでにあります",
        {},
        {
          cause: error,
        },
      );
    }
    throw error;
  }
  return { username };
}
