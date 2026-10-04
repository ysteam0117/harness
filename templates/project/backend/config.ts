// 設定の読み込みは、このファイルの1か所にまとめる（C-40）。ほかのファイルは process.env・env を直接読まない。
// 環境ごとの切り替え（APP_ENV・.env.test・テストが本番の設定を使わないための確認）は、このファイルに足していく。
export type AppConfig = {
  /** 環境の名前（development・test・production） */
  appEnv: string;
  /** 状態を変える要求を許可する送信元（C-28） */
  allowedOrigins: string[];
};

type RawEnv = Record<string, unknown>;

function text(env: RawEnv, name: string): string {
  const value = env[name];
  return typeof value === "string" ? value : "";
}

/** Workers の環境（c.env）から、アプリの設定を作る */
export function loadConfig(env: unknown): AppConfig {
  const raw = (typeof env === "object" && env !== null ? env : {}) as RawEnv;
  return {
    appEnv: text(raw, "APP_ENV") || "development",
    allowedOrigins: text(raw, "ALLOWED_ORIGINS")
      .split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin !== ""),
  };
}
