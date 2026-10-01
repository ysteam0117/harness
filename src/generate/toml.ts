import { GenerateError } from "./errors.js";

const BARE_KEY_RE = /^[A-Za-z0-9_-]+$/;
const LONE_SURROGATE_RE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

/** TOML の基本文字列（"..."）にする。\ " 改行 タブ とほかの制御文字（DEL を含む）をエスケープする。 */
export function tomlString(value: string): string {
  if (LONE_SURROGATE_RE.test(value)) {
    throw new GenerateError("TOML に書けない文字（対になっていないサロゲート）が含まれています");
  }
  let out = '"';
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === "\\") out += "\\\\";
    else if (ch === '"') out += '\\"';
    else if (ch === "\n") out += "\\n";
    else if (ch === "\t") out += "\\t";
    else if (code < 0x20 || code === 0x7f) {
      out += `\\u${code.toString(16).toUpperCase().padStart(4, "0")}`;
    } else out += ch;
  }
  return `${out}"`;
}

/** 「キー = "値"」の行だけの TOML を作る（キーも値も文字列）。 */
export function toToml(entries: [string, string][]): string {
  let out = "";
  for (const [key, value] of entries) {
    if (!BARE_KEY_RE.test(key)) {
      throw new GenerateError(`TOML のキー ${key} に使えない文字が含まれています`);
    }
    out += `${key} = ${tomlString(value)}\n`;
  }
  return out;
}
