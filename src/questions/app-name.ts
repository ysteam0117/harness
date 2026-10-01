/**
 * アプリ名の確かめ（対話の入力と、整合性チェックのルール9の両方がこの関数だけを使う）。
 * 英小文字・数字・ハイフンだけ。先頭と末尾はハイフンにできない
 * （`-` で始まるとコマンドの引数と取り違えられ、Docker のコンテナ名にも使えないため）。
 * 問題がなければ undefined、あれば日本語の理由を返す。
 */
export function validateAppName(name: string): string | undefined {
  if (name === "") return "アプリ名を入力してください";
  if (!/^[a-z0-9-]+$/.test(name)) {
    return "アプリ名には、英小文字・数字・ハイフンだけを使えます";
  }
  if (name.startsWith("-") || name.endsWith("-")) {
    return "アプリ名の先頭と末尾にハイフンは使えません（コマンドの引数と取り違えられ、Docker のコンテナ名にも使えないため）";
  }
  return undefined;
}
