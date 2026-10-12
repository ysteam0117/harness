/** パッケージの登録先の種類。npm は npm の登録情報、maven は Maven Central（と Java の版） */
export type Ecosystem = "npm" | "maven";

export const ECOSYSTEMS: readonly Ecosystem[] = ["npm", "maven"];

/** Java の版を調べる対象の名前（Node.js の "node" と同じ位置づけ） */
export const JAVA_TARGET_NAME = "java";

const COORDINATE_RE = /^([A-Za-z0-9_.-]+):([A-Za-z0-9_.-]+)$/;

/**
 * Maven の座標（group:artifact）を分ける。形が誤っていれば undefined。
 * group は "." 区切りで、空の部分を含めない。artifact は "." だけの名前にしない（URL の .. や / を作らせない）。
 */
export function parseCoordinate(name: string): { group: string; artifact: string } | undefined {
  const m = COORDINATE_RE.exec(name);
  if (m === null) return undefined;
  const group = m[1] ?? "";
  const artifact = m[2] ?? "";
  if (group.split(".").some((segment) => segment === "")) return undefined;
  if (/^\.+$/.test(artifact)) return undefined;
  return { group, artifact };
}
