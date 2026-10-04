// Controller（ルート）：要求を受けて、Service を呼び、応答の形にする（C-03）。
import { Hono } from "hono";
import { loadConfig } from "../config";
import { getHealth } from "../services/health.service";

export const healthRoutes = new Hono().get("/", (c) => {
  const config = loadConfig(c.env);
  return c.json(getHealth(config.appEnv));
});
