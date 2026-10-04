// Controller（ルート）：サンプルの利用者の一覧（GET）と追加（POST）。DB の処理は引数で受け取る（routes は db/ を直接読まない）。
// 入力は validate で確かめる（C-27）。送信元の確認（POST）は app.ts の /api/* で行う。
import { Hono } from "hono";
import { z } from "zod";
import { validate } from "../lib/validation";
import {
  addSampleUser,
  listSampleUsers,
  type WithSampleUsers,
} from "../services/sample-users.service";

const addSchema = z.object({
  username: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[A-Za-z0-9_]+$/),
});

export function sampleUserRoutes(withSampleUsers: WithSampleUsers) {
  return new Hono<{ Bindings: Env }>()
    .get("/", async (c) => {
      const users = await withSampleUsers(c.env, (repository) =>
        listSampleUsers(repository),
      );
      return c.json({ users });
    })
    .post("/", validate("json", addSchema), async (c) => {
      const { username } = c.req.valid("json");
      const user = await withSampleUsers(c.env, (repository) =>
        addSampleUser(repository, username),
      );
      return c.json(user, 201);
    });
}
