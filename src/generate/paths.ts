import { GenerateError } from "./errors.js";

const MAX_LISTED = 10;

/**
 * 出力先のパスの重なりを調べる（すべての出力に共通）。重なった2つのパスを示してエラーにする。
 * 重なり：同じパス・大文字小文字だけが違うパス・あるファイルが別の出力の親フォルダになる場合。
 * 似た名前（.claude-extra/x.ts と .claude、AGENTS.md.bak と AGENTS.md）は重なりにしない。
 */
export function checkOutputPaths(paths: string[]): void {
  const byKey = new Map<string, string>();
  const problems: string[] = [];
  for (const p of paths) {
    const key = p.toLowerCase();
    const other = byKey.get(key);
    if (other !== undefined) {
      problems.push(
        other === p
          ? `${p} が重なっています`
          : `${other} と ${p} が重なっています（大文字・小文字だけの違い）`,
      );
    } else {
      byKey.set(key, p);
    }
  }
  for (const p of paths) {
    const segments = p.toLowerCase().split("/");
    for (let n = 1; n < segments.length; n += 1) {
      const parent = byKey.get(segments.slice(0, n).join("/"));
      if (parent !== undefined) {
        problems.push(`${parent} がファイルとして出力される一方で、${p} がその中に出力されます`);
      }
    }
  }
  if (problems.length === 0) return;
  const listed = problems.slice(0, MAX_LISTED).join("、");
  const more = problems.length > MAX_LISTED ? `、ほか${problems.length - MAX_LISTED}件` : "";
  throw new GenerateError(`出力先が重なっています：${listed}${more}`);
}
