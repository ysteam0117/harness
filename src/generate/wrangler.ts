import { isPlainObject } from "./data.js";
import { mergeWrangler, type Profile } from "./profile.js";
import { renderTemplate } from "./template.js";

export type BuildWranglerInput = {
  /** 選んだプロファイル（resolveProfiles の結果） */
  profiles: Profile[];
  /** wrangler_when の条件に使う回答 */
  answers: object;
  /** 名前 → 値。まとめた設定の文字列の {{名前}} に差し込む */
  values: Record<string, string>;
};

/** wrangler.jsonc の先頭に並べる項目（読みやすさのため）。ほかの項目は、名前の昇順で、このあとに並べる */
const FIRST_KEYS = ["name", "main", "compatibility_date", "compatibility_flags", "assets", "vars"];

function orderKeys(value: Record<string, unknown>): Record<string, unknown> {
  const keys = Object.keys(value);
  const first = FIRST_KEYS.filter((k) => keys.includes(k));
  const rest = keys.filter((k) => !first.includes(k)).sort();
  return Object.fromEntries([...first, ...rest].map((k) => [k, value[k]]));
}

const HEADER = [
  "// Cloudflare Workers の設定。ハーネスが、選んだ技術プロファイルの設定をまとめて作った。",
  "// D1・Hyperdrive・R2 のつなぎ方は、DB・ファイル保存の回答で変わる。",
  "// Hyperdrive の手元の接続先は、このファイルに書かず、環境変数で渡す（.env.example を見る）。",
  "// Hyperdrive の id など本番の値は、デプロイの設定で本物にする（ここにあるのは、手元の開発用の仮の値）。",
];

/** まとめた設定の、文字列の値だけに {{名前}} を差し込む（JSON にしてから置き換えないため、" や \ があっても壊れない） */
function fill(value: unknown, values: Record<string, string>): unknown {
  if (typeof value === "string") {
    return renderTemplate(value, values, { templatesDir: "", fileName: "wrangler.jsonc" });
  }
  if (Array.isArray(value)) return value.map((v) => fill(v, values));
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, values)]));
  }
  return value;
}

/**
 * wrangler.jsonc の中身を組み立てる。プロファイルの wrangler・回答に合う wrangler_when を深くまとめ、
 * 値の {{名前}} を差し込んで JSON にし、先頭に説明の「//」の行を付ける。同じ入力なら同じ結果になる。
 */
export function buildWranglerJsonc(input: BuildWranglerInput): string {
  const merged = mergeWrangler(input.profiles, input.answers);
  const filled = fill(orderKeys(merged), input.values);
  return `${HEADER.join("\n")}\n${JSON.stringify(filled, null, 2)}\n`;
}
