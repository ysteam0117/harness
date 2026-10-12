import { parseCoordinate } from "./ecosystem.js";
import { parseMavenMetadata } from "./maven-metadata.js";
import type { Target } from "./targets.js";

export type FetchResult = { ok: true; versions: string[] } | { ok: false; reason: string };

export interface RegistryOptions {
  /** 1回の取得の時間切れ（ミリ秒）。既定は 10000 */
  timeoutMs?: number;
  /** 同時に取得する数の上限。既定は 6 */
  concurrency?: number;
  limit?: () => Promise<() => void>;
}

const NPM_BASE = "https://registry.npmjs.org/";
const NODE_INDEX_URL = "https://nodejs.org/dist/index.json";
const MAVEN_CENTRAL_BASE = "https://repo1.maven.org/maven2/";
const ADOPTIUM_RELEASES_URL = "https://api.adoptium.net/v3/info/available_releases";
const NPM_ACCEPT = "application/vnd.npm.install-v1+json";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_CONCURRENCY = 6;

/** Shared concurrency slots; acquire before starting the request timeout. */
export function limitFetchConcurrency(
  concurrency: number = DEFAULT_CONCURRENCY,
): NonNullable<RegistryOptions["limit"]> {
  const limit = Math.max(1, concurrency);
  let inFlight = 0;
  const waiting: (() => void)[] = [];
  return async () => {
    if (inFlight >= limit) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    } else {
      inFlight++;
    }
    return () => {
      const next = waiting.shift();
      if (next === undefined) inFlight--;
      else next(); // 空いた枠を、次の呼び出しに渡す
    };
  };
}

/** 取得の失敗。message は、利用者に見せる理由 */
class FetchFailure extends Error {}

/** 例外から、利用者に見せる理由を作る（時間切れは、その旨を示す） */
function describeError(e: unknown, timeoutMs: number, timedOut: boolean): string {
  if (timedOut) return `時間切れ（${timeoutMs / 1000} 秒以内に応答がありませんでした）`;
  if (e instanceof FetchFailure) return e.message;
  const message = e instanceof Error ? e.message : String(e);
  const cause = e instanceof Error && e.cause instanceof Error ? `（${e.cause.message}）` : "";
  return `接続できません：${message}${cause}`;
}

/** 応答の本文を、JSON か文字列として取得する。失敗は FetchFailure（利用者に見せる理由つき） */
async function getBody(
  url: string,
  headers: Record<string, string>,
  fetchFn: typeof fetch,
  timeoutMs: number,
  as: "json" | "text",
  limit?: RegistryOptions["limit"],
): Promise<unknown> {
  const release = limit === undefined ? undefined : await limit();
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetchFn(url, { headers, signal: controller.signal });
    if (!response.ok) {
      throw new FetchFailure(`HTTP ${response.status} が返されました（${url}）`);
    }
    try {
      return as === "json" ? await response.json() : await response.text();
    } catch (e) {
      if (timedOut) throw e;
      throw new FetchFailure(
        as === "json" ? `応答を JSON として読めません（${url}）` : `応答を読めません（${url}）`,
        { cause: e },
      );
    }
  } catch (e) {
    throw new FetchFailure(describeError(e, timeoutMs, timedOut), { cause: e });
  } finally {
    clearTimeout(timer);
    release?.();
  }
}

function npmUrl(name: string): string {
  // スコープ付き（@scope/name）は、@ 以降の区切りの / をエンコードする
  return `${NPM_BASE}${name.replace("/", "%2F")}`;
}

/** npm の登録情報：版の一覧と、版ごとの peerDependencies（書いてない版は空） */
export type PackageInfoResult =
  | { ok: true; versions: string[]; peers: Record<string, Record<string, string>> }
  | { ok: false; reason: string };

/** パッケージの版の一覧と、版ごとの peerDependencies を取得する。失敗は例外にせず ok: false と理由にする */
export async function fetchPackageInfo(
  name: string,
  fetchFn: typeof fetch,
  opts: Pick<RegistryOptions, "timeoutMs" | "limit"> = {},
): Promise<PackageInfoResult> {
  try {
    const body = await getBody(
      npmUrl(name),
      { Accept: NPM_ACCEPT },
      fetchFn,
      opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      "json",
      opts.limit,
    );
    const versions = (body as { versions?: unknown } | null)?.versions;
    if (typeof versions !== "object" || versions === null || Array.isArray(versions)) {
      return { ok: false, reason: "登録情報の形が想定と違います（versions がありません）" };
    }
    const peers: Record<string, Record<string, string>> = {};
    for (const [version, meta] of Object.entries(versions)) {
      const peer = (meta as { peerDependencies?: unknown } | null)?.peerDependencies;
      if (typeof peer !== "object" || peer === null || Array.isArray(peer)) continue;
      const entries = Object.entries(peer).filter(
        (e): e is [string, string] => typeof e[1] === "string",
      );
      if (entries.length > 0) peers[version] = Object.fromEntries(entries);
    }
    return { ok: true, versions: Object.keys(versions), peers };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

async function fetchNpm(
  name: string,
  fetchFn: typeof fetch,
  timeoutMs: number,
  limit?: RegistryOptions["limit"],
): Promise<FetchResult> {
  const info = await fetchPackageInfo(name, fetchFn, { timeoutMs, ...(limit ? { limit } : {}) });
  return info.ok ? { ok: true, versions: info.versions } : info;
}

async function fetchNode(
  fetchFn: typeof fetch,
  timeoutMs: number,
  limit?: RegistryOptions["limit"],
): Promise<FetchResult> {
  try {
    const body = await getBody(NODE_INDEX_URL, {}, fetchFn, timeoutMs, "json", limit);
    if (!Array.isArray(body)) {
      return { ok: false, reason: "登録情報の形が想定と違います（版の一覧ではありません）" };
    }
    const versions: string[] = [];
    for (const item of body as { version?: unknown; lts?: unknown }[]) {
      if (typeof item?.version !== "string") {
        return { ok: false, reason: "登録情報の形が想定と違います（version がありません）" };
      }
      if (item.lts !== false && item.lts !== undefined) {
        versions.push(item.version.replace(/^v/, ""));
      }
    }
    return { ok: true, versions };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

/** Maven Central の maven-metadata.xml の URL。座標の形が誤っていれば undefined */
export function mavenMetadataUrl(name: string): string | undefined {
  const coordinate = parseCoordinate(name);
  if (coordinate === undefined) return undefined;
  const group = coordinate.group.split(".").map(encodeURIComponent).join("/");
  return `${MAVEN_CENTRAL_BASE}${group}/${encodeURIComponent(coordinate.artifact)}/maven-metadata.xml`;
}

async function fetchMaven(
  name: string,
  fetchFn: typeof fetch,
  timeoutMs: number,
  limit?: RegistryOptions["limit"],
): Promise<FetchResult> {
  const url = mavenMetadataUrl(name);
  if (url === undefined)
    return { ok: false, reason: "登録情報の形が想定と違います（座標の形が誤っています）" };
  try {
    const body = await getBody(url, {}, fetchFn, timeoutMs, "text", limit);
    return parseMavenMetadata(body as string);
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

/** Java の版：Adoptium の登録情報にある、長期サポート（LTS）の大きな版（25 など）の一覧 */
async function fetchJava(
  fetchFn: typeof fetch,
  timeoutMs: number,
  limit?: RegistryOptions["limit"],
): Promise<FetchResult> {
  try {
    const body = await getBody(ADOPTIUM_RELEASES_URL, {}, fetchFn, timeoutMs, "json", limit);
    const lts = (body as { available_lts_releases?: unknown } | null)?.available_lts_releases;
    if (!Array.isArray(lts) || lts.length === 0) {
      return { ok: false, reason: "登録情報の形が想定と違います（LTS の一覧がありません）" };
    }
    const versions: string[] = [];
    for (const item of lts) {
      if (typeof item !== "number" || !Number.isInteger(item) || item <= 0) {
        return { ok: false, reason: "登録情報の形が想定と違います（LTS の版が数ではありません）" };
      }
      versions.push(String(item));
    }
    return { ok: true, versions };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

async function fetchTarget(
  target: Target,
  fetchFn: typeof fetch,
  timeoutMs: number,
  limit?: RegistryOptions["limit"],
): Promise<FetchResult> {
  switch (target.kind) {
    case "node":
      return fetchNode(fetchFn, timeoutMs, limit);
    case "java":
      return fetchJava(fetchFn, timeoutMs, limit);
    case "maven":
      return fetchMaven(target.name, fetchFn, timeoutMs, limit);
    case "npm":
      return fetchNpm(target.name, fetchFn, timeoutMs, limit);
  }
}

/**
 * 対象ごとの、登録情報にある版の一覧を取得する。キーは Target.name。
 * 取得できないもの（つながらない・時間切れ・HTTP のエラー）は、例外にせず ok: false と理由にする。
 * 試験版も含めて、そのまま返す（選ぶのは select.ts）。Node.js と Java は LTS だけ。Maven は Maven Central の maven-metadata.xml。
 */
export async function fetchVersionLists(
  targets: Target[],
  fetchFn: typeof fetch,
  opts: RegistryOptions = {},
): Promise<Map<string, FetchResult>> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY);
  const results = new Map<string, FetchResult>();
  const queue = [...targets];

  const worker = async (): Promise<void> => {
    for (let target = queue.shift(); target !== undefined; target = queue.shift()) {
      results.set(target.name, await fetchTarget(target, fetchFn, timeoutMs, opts.limit));
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  // 入力の並びで返す
  return new Map(targets.map((t) => [t.name, results.get(t.name) as FetchResult]));
}
