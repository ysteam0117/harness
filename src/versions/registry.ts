import type { Target } from "./targets.js";

export type FetchResult = { ok: true; versions: string[] } | { ok: false; reason: string };

export interface RegistryOptions {
  /** 1回の取得の時間切れ（ミリ秒）。既定は 10000 */
  timeoutMs?: number;
  /** 同時に取得する数の上限。既定は 6 */
  concurrency?: number;
}

const NPM_BASE = "https://registry.npmjs.org/";
const NODE_INDEX_URL = "https://nodejs.org/dist/index.json";
const NPM_ACCEPT = "application/vnd.npm.install-v1+json";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_CONCURRENCY = 6;

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

async function getJson(
  url: string,
  headers: Record<string, string>,
  fetchFn: typeof fetch,
  timeoutMs: number,
): Promise<unknown> {
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
      return await response.json();
    } catch (e) {
      if (timedOut) throw e;
      throw new FetchFailure(`応答を JSON として読めません（${url}）`, { cause: e });
    }
  } catch (e) {
    throw new FetchFailure(describeError(e, timeoutMs, timedOut), { cause: e });
  } finally {
    clearTimeout(timer);
  }
}

function npmUrl(name: string): string {
  // スコープ付き（@scope/name）は、@ 以降の区切りの / をエンコードする
  return `${NPM_BASE}${name.replace("/", "%2F")}`;
}

async function fetchNpm(
  name: string,
  fetchFn: typeof fetch,
  timeoutMs: number,
): Promise<FetchResult> {
  try {
    const body = await getJson(npmUrl(name), { Accept: NPM_ACCEPT }, fetchFn, timeoutMs);
    const versions = (body as { versions?: unknown } | null)?.versions;
    if (typeof versions !== "object" || versions === null || Array.isArray(versions)) {
      return { ok: false, reason: "登録情報の形が想定と違います（versions がありません）" };
    }
    return { ok: true, versions: Object.keys(versions) };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

async function fetchNode(fetchFn: typeof fetch, timeoutMs: number): Promise<FetchResult> {
  try {
    const body = await getJson(NODE_INDEX_URL, {}, fetchFn, timeoutMs);
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

/**
 * 対象ごとの、登録情報にある版の一覧を取得する。キーは Target.name。
 * 取得できないもの（つながらない・時間切れ・HTTP のエラー）は、例外にせず ok: false と理由にする。
 * 試験版も含めて、そのまま返す（選ぶのは select.ts）。Node.js は LTS だけ。
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
      results.set(
        target.name,
        target.kind === "node"
          ? await fetchNode(fetchFn, timeoutMs)
          : await fetchNpm(target.name, fetchFn, timeoutMs),
      );
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  // 入力の並びで返す
  return new Map(targets.map((t) => [t.name, results.get(t.name) as FetchResult]));
}
