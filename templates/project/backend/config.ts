// 設定の読み込みは、このファイルの1か所にまとめる（C-40）。ほかのファイルは process.env・env を直接読まない。
// 起動経路で選んだ APP_ENV を必須にし、欠落を既定値で隠さない。
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
  const appEnv = text(raw, "APP_ENV");
  if (!["development", "test", "production"].includes(appEnv)) {
    throw new Error("APP_ENV を設定してください（値は表示しません）。");
  }
  return {
    appEnv,
    allowedOrigins: text(raw, "ALLOWED_ORIGINS")
      .split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin !== ""),
  };
}
