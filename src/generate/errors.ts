/** ひな形の差し込み・プロファイルの読み込み・出力の組み立てで起きる誤り。メッセージは日本語。 */
export class GenerateError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GenerateError";
  }
}
