import { describe, expect, it } from "vitest";
import { createApp } from "../app";

const app = createApp();

describe("GET /api/health", () => {
  it("状態が ok で、環境の名前を返す", async () => {
    const res = await app.request("/api/health", {}, { APP_ENV: "test" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", appEnv: "test" });
  });

  it("セキュリティヘッダーが付く（C-27）", async () => {
    const res = await app.request("/api/health");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("Content-Security-Policy")).toContain(
      "default-src 'self'",
    );
  });

  it("状態を変える要求は、許可していない送信元だと拒否する（C-28）", async () => {
    const res = await app.request(
      "/api/health",
      { method: "POST", headers: { Origin: "https://attacker.example.com" } },
      { APP_ENV: "test", ALLOWED_ORIGINS: "http://localhost:5173" },
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "FORBIDDEN_ORIGIN" });
  });

  it("存在しないAPIは、共通の形で 404 を返す", async () => {
    const res = await app.request("/api/not-found");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "NOT_FOUND" });
  });
});
