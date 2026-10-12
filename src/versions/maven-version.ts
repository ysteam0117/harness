// Maven の版（1.10.2、1.0.0-RC1、1.0.Final など）の判定と比較。semver とは別に、自前で扱う。

/** 試験版を示す修飾子（大文字小文字を区別しない） */
const PRERELEASE_WORDS = new Set([
  "snapshot",
  "alpha",
  "beta",
  "milestone",
  "rc",
  "cr",
  "preview",
  "ea",
  "dev",
]);
/** 修飾子なしと同じ（正式版）として扱う修飾子 */
const RELEASE_WORDS = new Set(["final", "ga", "release"]);
/** 試験版どうしの順序（小さいほど古い）。m は M数字（マイルストーン） */
const PRERELEASE_ORDER = [
  "dev",
  "alpha",
  "beta",
  "milestone",
  "m",
  "preview",
  "ea",
  "rc",
  "cr",
  "snapshot",
];

export interface ParsedMavenVersion {
  /** 先頭の数字の並び（先頭の0は除いた文字列） */
  numbers: string[];
  /** 数字のあとの修飾子（なければ ""） */
  qualifier: string;
}

/** 版を読む。数字で始まらない版は undefined（無視する） */
export function parseMavenVersion(version: string): ParsedMavenVersion | undefined {
  const m = /^(\d+(?:\.\d+)*)(?:[.\-_]?(.*))?$/.exec(version);
  if (m === null) return undefined;
  const numbers = (m[1] ?? "").split(".").map((n) => n.replace(/^0+(?=\d)/, ""));
  return { numbers, qualifier: m[2] ?? "" };
}

function tokensOf(qualifier: string): string[] {
  return qualifier.toLowerCase().match(/[a-z]+|\d+/g) ?? [];
}

function isReleaseQualifier(qualifier: string): boolean {
  if (qualifier === "") return true;
  const tokens = tokensOf(qualifier);
  return tokens.length === 1 && RELEASE_WORDS.has(tokens[0] ?? "");
}

function prereleaseRank(qualifier: string): number | undefined {
  const tokens = tokensOf(qualifier);
  for (const [i, token] of tokens.entries()) {
    if (PRERELEASE_WORDS.has(token)) return PRERELEASE_ORDER.indexOf(token);
    if (token === "m" && /^\d+$/.test(tokens[i + 1] ?? "")) return PRERELEASE_ORDER.indexOf("m");
  }
  return undefined;
}

/** 安定版か（SNAPSHOT・alpha・beta・M数字・milestone・RC・CR・preview・ea・dev を含まない版）。読めない版は false */
export function isStableMavenVersion(version: string): boolean {
  const parsed = parseMavenVersion(version);
  return parsed !== undefined && prereleaseRank(parsed.qualifier) === undefined;
}

function compareNumberStrings(a: string, b: string): number {
  if (a.length !== b.length) return a.length < b.length ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 修飾子の順序（試験版 < 修飾子なし = Final = GA = RELEASE < ほかの修飾子） */
function compareQualifiers(a: string, b: string): number {
  const group = (q: string): number => {
    if (prereleaseRank(q) !== undefined) return 0;
    return isReleaseQualifier(q) ? 1 : 2;
  };
  const ga = group(a);
  const gb = group(b);
  if (ga !== gb) return ga < gb ? -1 : 1;
  if (ga === 1) return 0;
  if (ga === 0) {
    const ra = prereleaseRank(a) ?? 0;
    const rb = prereleaseRank(b) ?? 0;
    if (ra !== rb) return ra < rb ? -1 : 1;
  }
  const na = Number(tokensOf(a).find((t) => /^\d+$/.test(t)) ?? 0);
  const nb = Number(tokensOf(b).find((t) => /^\d+$/.test(t)) ?? 0);
  if (na !== nb) return na < nb ? -1 : 1;
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  return la < lb ? -1 : la > lb ? 1 : 0;
}

/** 版の比較。数字は数として比べ（1.10 > 1.9、1.0 = 1.0.0）、等しければ修飾子で比べる。読めない版は例外 */
export function compareMavenVersions(a: string, b: string): number {
  const pa = parseMavenVersion(a);
  const pb = parseMavenVersion(b);
  if (pa === undefined || pb === undefined) {
    throw new Error(`Maven の版として読めません：${pa === undefined ? a : b}`);
  }
  const length = Math.max(pa.numbers.length, pb.numbers.length);
  for (let i = 0; i < length; i++) {
    const c = compareNumberStrings(pa.numbers[i] ?? "0", pb.numbers[i] ?? "0");
    if (c !== 0) return c;
  }
  return compareQualifiers(pa.qualifier, pb.qualifier);
}

/** 先頭の数字（大きな版）。読めない版は undefined */
export function mavenMajor(version: string): string | undefined {
  return parseMavenVersion(version)?.numbers[0];
}

/** 大きな版（先頭の数字）が違うか。どちらかが読めなければ false */
export function mavenMajorDiffers(a: string, b: string): boolean {
  const ma = mavenMajor(a);
  const mb = mavenMajor(b);
  return ma !== undefined && mb !== undefined && ma !== mb;
}

/** Maven の範囲は「>=X <Y」の形だけ（X < Y） */
export interface MavenRange {
  min: string;
  max: string;
}

const RANGE_RE = /^>=(\S+) <(\S+)$/;

/** 範囲を読む。形が誤っている、X が Y 以上、版が読めないときは undefined */
export function parseMavenRange(range: string): MavenRange | undefined {
  const m = RANGE_RE.exec(range);
  if (m === null) return undefined;
  const min = m[1] ?? "";
  const max = m[2] ?? "";
  if (parseMavenVersion(min) === undefined || parseMavenVersion(max) === undefined) {
    return undefined;
  }
  if (compareMavenVersions(min, max) >= 0) return undefined;
  return { min, max };
}

/** 版が範囲に合うか。範囲か版が読めなければ false */
export function satisfiesMavenRange(version: string, range: string): boolean {
  const parsed = parseMavenRange(range);
  if (parsed === undefined || parseMavenVersion(version) === undefined) return false;
  return (
    compareMavenVersions(version, parsed.min) >= 0 && compareMavenVersions(version, parsed.max) < 0
  );
}

/** 2つの範囲の交わり。空（合う版がない）か、読めなければ undefined */
export function intersectMavenRanges(a: string, b: string): string | undefined {
  const ra = parseMavenRange(a);
  const rb = parseMavenRange(b);
  if (ra === undefined || rb === undefined) return undefined;
  const min = compareMavenVersions(ra.min, rb.min) >= 0 ? ra.min : rb.min;
  const max = compareMavenVersions(ra.max, rb.max) <= 0 ? ra.max : rb.max;
  if (compareMavenVersions(min, max) >= 0) return undefined;
  return `>=${min} <${max}`;
}

/** 安定版の中で、範囲（あれば）に合う最大の版。読めない版・試験版は無視する */
export function pickLatestStableMaven(versions: string[], range?: string): string | undefined {
  let best: string | undefined;
  for (const v of versions) {
    if (!isStableMavenVersion(v)) continue;
    if (range !== undefined && !satisfiesMavenRange(v, range)) continue;
    if (best === undefined || compareMavenVersions(v, best) > 0) best = v;
  }
  return best;
}
