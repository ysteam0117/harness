// Service：業務の処理。HTTP（Hono）を知らない（C-03）。
export type HealthStatus = {
  status: "ok";
  appEnv: string;
};

export function getHealth(appEnv: string): HealthStatus {
  return { status: "ok", appEnv };
}
