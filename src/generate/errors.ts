/** 生成・更新・導入の全体で使う、例外まわりの共通の部品（誤りの型と、例外から値を取り出す関数）。 */

/** ひな形の差し込み・プロファイルの読み込み・出力の組み立てで起きる誤り。メッセージは日本語。 */
export class GenerateError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GenerateError";
  }
}

/** 例外の本文（Error でなければ文字列にする） */
export function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 例外の code（ENOENT など。無ければ undefined） */
export function codeOf(e: unknown): string | undefined {
  return typeof e === "object" && e !== null ? (e as NodeJS.ErrnoException).code : undefined;
}
