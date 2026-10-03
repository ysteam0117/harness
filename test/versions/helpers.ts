// #33 テスト共通の道具（偽の fetch・架空の登録情報）。本物のネットワークにはつながない。
//
// 想定する型（実装の役割はこの形に合わせる）
//
//   // src/versions/targets.ts
//   export interface Target {
//     kind: "npm" | "node";
//     name: string;               // npm のパッケージ名。Node.js は "node"
//     verified?: string;          // 検証済みの版。unverified のときは無い
//     range?: string;             // semver の範囲（複数のプロファイルの範囲は交わり）。無ければ範囲なし
//     unverified: boolean;        // 検証済みがないパッケージ（profile.yaml の unverified）
//     profiles: string[];         // このパッケージを持つプロファイルの key（Node.js は []）
//   }
//   export function buildTargets(profiles: Profile[], answers: Partial<Answers>): Target[];
//        // 先頭に Node.js（data/runtimes.yaml）。packages ＋ 回答に合う packages_when を集める。external_tools は含めない
//   export function targetsFor(answers: Partial<Answers>, templatesDir?: string): Target[];
//        // selectProfiles → resolveProfiles → buildTargets（templatesDir の既定は実際の templates/）
//
//   // src/versions/registry.ts
//   export type FetchResult = { ok: true; versions: string[] } | { ok: false; reason: string };
//   export function fetchVersionLists(
//     targets: Target[],
//     fetchFn: typeof fetch,
//     opts?: { timeoutMs?: number /* 既定 10000 */; concurrency?: number /* 既定 6 */ },
//   ): Promise<Map<string, FetchResult>>;       // キーは Target.name。Node.js の版は "v" を除き、LTS だけ
//
//   // src/versions/select.ts
//   export function pickLatestStable(versions: string[], range?: string): string | undefined;
//   export function compareWithVerified(verified: string, candidate: string):
//     { kind: "same" | "newer" | "older"; majorDiffers: boolean };
//
//   // src/versions/choose.ts
//   export interface VersionEntry {
//     name: string;
//     version: string;               // 採用した版
//     reason: string;                // 選定理由
//     surveyedOn: string;            // 調べた日（YYYY-MM-DD）
//     latestStable: string | null;   // そのとき確認した最新の安定版（範囲内）。found 以外なら null
//     latestStatus: "found" | "none_in_range" | "failed";
//                                    // found：取得でき、範囲内の安定版があった／none_in_range：取得できたが範囲に合う安定版がない／failed：取得できなかった（未確認）
//     fetchFailure?: string;         // failed のとき、取得できなかった理由（ECONNREFUSED など）。方針や versions の指定にかかわらず残す
//     verified: string | null;       // 検証済み。無ければ null
//     newerThanVerified: boolean;    // 採用した版が検証済みより新しい
//     majorDiffers: boolean;         // 採用した版が検証済みと大きな版（メジャー）が違う
//   }
//   export interface VersionResult { entries: VersionEntry[]; newerThanVerified: boolean }
//   export type ChooseOutcome = { status: "ok"; result: VersionResult } | { status: "stopped"; message: string };
//   export interface ChooseOptions {
//     targets: Target[];
//     policy: "verified" | "latest";            // 質問16 version_policy
//     interactive: boolean;
//     prompter: Prompter;                       // interactive が false のときは、入力（select・confirm など）を使わない。表示（note）は使ってよい
//     fetch: typeof fetch;
//     now: Date;
//     versions?: Record<string, "verified" | "latest">;   // --answers の versions
//     versionsOffline?: "verified";                        // --answers の versions_offline
//     keep?: VersionEntry[];                    // 既に選んだもの（R3）。ここにある名前は調べ直さず、そのまま結果に入れる
//     timeoutMs?: number; concurrency?: number;
//   }
//   export function chooseVersions(opts: ChooseOptions): Promise<ChooseOutcome>;
//   入力の id（FakePrompter の script のキー）
//     "versions_mode"            select  値 "latest"（すべて最新の安定版）| "verified"（すべて検証済み）| "each"（技術ごとに選ぶ）
//     "version_pick:<name>"      select  値 "latest" | "verified"（技術ごと）
//     "versions_offline_confirm" confirm 取得できなかったとき「検証済みのバージョンで進めますか」
//   表示（prompter.note）：パッケージごとの「検証済み｜最新の安定版（範囲内）｜比較」の表、警告、取得できなかった理由
//
//   // src/versions/tech-stack.ts
//   export function renderTechStack(
//     result: VersionResult,
//     profiles: Pick<Profile, "key" | "name" | "compatibilityNotes">[],
//   ): string;   // Markdown。技術ごとの表の行に、採用した版・選定理由・調べた日・最新の安定版（または「未確認」）・検証済みを入れる
//
//   // src/versions/profile-selection.ts
//   export interface SelectionRule { profile: string; when?: { answer: string; equals?: string; in?: string[]; notEquals?: string } }
//   export function parseProfileSelection(text: string, templatesDir?: string): SelectionRule[];  // 誤りは GenerateError
//   export function selectProfiles(answers: Partial<Answers>, rules?: SelectionRule[]): string[];  // プロファイルの key の一覧（既定は data/profile-selection.yaml）
//
//   // src/generate/profile.ts の Profile に足す項目
//   packages: string[]; verifiedVersions: Record<string, string>; versionRanges: Record<string, string>;
//   externalTools: string[]; unverified: string[]; compatibilityNotes: string[];
//   packagesWhen: { when: Record<string, string>; packages: string[] }[];
//
//   // src/commands/create.ts
//   CreateDeps に fetch?: typeof fetch（既定は globalThis.fetch）と now?: () => Date を足す。
//   CreateOutcome に versions?: VersionResult と techStack?: string（tech-stack.md の中身）を足す。
//
// 前提（実装の役割が templates/profiles の profile.yaml に書く値。R1・R2・R8）
//   test-framework/vitest-playwright：version_ranges { vitest: "^4" }、external_tools [k6]（packages から k6 を除く）、
//     @testing-library/user-event の検証済みの版（範囲に合う安定版。値は実装の役割が決める）、unverified は空
//   quality/typescript-standard：version_ranges { typescript: ">=6.0.0 <6.1.0" }
//   data-access/drizzle：packages_when [{ when: { database: postgresql }, packages: [pg] }]、
//     verified_versions に pg: "8.23.0"、version_ranges { pg: ">=8.13.0" }
//   data/runtimes.yaml：node: { verified: "24.19.0", policy: lts }
//   data/profile-selection.yaml：常に 7 つ（hono・structured-logger・vite-react-router・axios・tanstack-query-rhf-zod・
//     vitest-playwright・typescript-standard）、database が none でなければ data-access/drizzle

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { realTemplatesDir } from "../generate/helpers.js";

type NpmGiven = string[] | Error | number | "hang";

export interface FakeFetchSpec {
  /** パッケージ名 → 版の一覧 | Error（つながらない） | HTTP の状態（500 など） | "hang"（応答しない。signal で中断される） */
  npm?: Record<string, NpmGiven>;
  /** 指定のないパッケージの版の一覧（undefined を返すと 404） */
  npmFallback?: (name: string) => string[] | undefined;
  /** dist-tags の latest を上書きする（試験版を指す場合など） */
  distTags?: Record<string, string>;
  /** Node.js の index.json */
  node?: { version: string; lts: string | false }[] | Error | number | "hang";
  /** 1回の応答までの遅れ（ミリ秒）。同時に実行している数を測るため */
  delayMs?: number;
}

export interface FakeFetch {
  fn: typeof fetch;
  calls: { url: string; accept: string | null }[];
  readonly maxInFlight: number;
  urls(): string[];
  /** npm へ取得に来たパッケージ名 */
  npmNames(): string[];
}

const NPM_BASE = "https://registry.npmjs.org/";
const NODE_URL = "https://nodejs.org/dist/index.json";

export function fakeFetch(spec: FakeFetchSpec = {}): FakeFetch {
  const calls: FakeFetch["calls"] = [];
  let inFlight = 0;
  const stat = { max: 0 };

  const respond = async (
    value: unknown,
    signal: AbortSignal | undefined,
    body: (v: never) => unknown,
  ): Promise<Response> => {
    if (value === "hang") {
      return new Promise<Response>((_, reject) => {
        signal?.addEventListener("abort", () =>
          reject(new DOMException("The operation was aborted", "AbortError")),
        );
      });
    }
    if (value instanceof Error) throw value;
    if (typeof value === "number") return new Response("error", { status: value });
    return new Response(JSON.stringify(body(value as never)), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const fn = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input);
    const headers = new Headers(init?.headers);
    calls.push({ url, accept: headers.get("accept") });
    inFlight++;
    stat.max = Math.max(stat.max, inFlight);
    try {
      if (spec.delayMs) await new Promise((r) => setTimeout(r, spec.delayMs));
      const signal = init?.signal ?? undefined;
      if (url === NODE_URL) {
        return await respond(
          spec.node ?? [],
          signal,
          (v: { version: string; lts: string | false }[]) => v,
        );
      }
      if (url.startsWith(NPM_BASE)) {
        const name = decodeURIComponent(url.slice(NPM_BASE.length));
        const given = spec.npm?.[name] ?? spec.npmFallback?.(name);
        if (given === undefined) return new Response("not found", { status: 404 });
        return await respond(given, signal, (versions: string[]) => ({
          name,
          versions: Object.fromEntries(versions.map((v) => [v, { name, version: v }])),
          "dist-tags": spec.distTags ?? { latest: versions[versions.length - 1] },
        }));
      }
      throw new Error(`想定外の URL です：${url}`);
    } finally {
      inFlight--;
    }
  }) as typeof fetch;

  return {
    fn,
    calls,
    get maxInFlight() {
      return stat.max;
    },
    urls: () => calls.map((c) => c.url),
    npmNames: () =>
      calls
        .filter((c) => c.url.startsWith(NPM_BASE))
        .map((c) => decodeURIComponent(c.url.slice(NPM_BASE.length))),
  };
}

/** すべての取得が失敗する fetch（ネットワークにつながらない） */
export function offlineFetch(): FakeFetch {
  return fakeFetch({
    npmFallback: () => undefined,
    node: new Error("getaddrinfo ENOTFOUND (fake)"),
  });
}

/** 実際の templates/profiles の verified_versions を、名前 → 版 で集める（実装の読み込みを使わず、YAML を直接読む） */
export function realVerifiedVersions(): Record<string, string> {
  const out: Record<string, string> = {};
  const root = path.join(realTemplatesDir, "profiles");
  for (const category of readdirSync(root)) {
    for (const id of readdirSync(path.join(root, category))) {
      if (id === "_shared") continue;
      const data = parse(readFileSync(path.join(root, category, id, "profile.yaml"), "utf8")) as {
        verified_versions?: Record<string, string>;
      };
      Object.assign(out, data.verified_versions ?? {});
    }
  }
  return out;
}

/**
 * 実際のプロファイルに合わせた、すべて成功する偽の登録情報。
 * 既定は「検証済みの版と、試験版（99.0.0-rc.1）」だけ。名前を指定すると、その一覧を使う。
 * 検証済みの記載がない名前（pg など）は 1.0.0 だけにする。
 */
export function registryForReal(
  npm: Record<string, NpmGiven> = {},
  extra: Pick<FakeFetchSpec, "node" | "distTags" | "delayMs"> = {},
): FakeFetch {
  const verified = realVerifiedVersions();
  return fakeFetch({
    ...extra,
    npm,
    npmFallback: (name) => {
      const v = verified[name];
      return v ? [v, "99.0.0-rc.1"] : ["1.0.0"];
    },
    node: extra.node ?? [
      { version: "v25.1.0", lts: false },
      { version: "v24.19.0", lts: "Krypton" },
      { version: "v22.20.0", lts: "Jod" },
    ],
  });
}

/** Target の組み立て（choose などのテスト用の小さな道具）。unverified のときは verified を持たない */
export function npmTarget(
  name: string,
  over: { verified?: string; range?: string; unverified?: boolean; profiles?: string[] } = {},
) {
  const target: {
    kind: "npm";
    name: string;
    verified?: string;
    range?: string;
    unverified: boolean;
    profiles: string[];
  } = {
    kind: "npm",
    name,
    unverified: over.unverified ?? false,
    profiles: over.profiles ?? ["lib/alpha"],
  };
  if (!over.unverified) target.verified = over.verified ?? "1.0.0";
  if (over.range !== undefined) target.range = over.range;
  return target;
}

export function nodeTarget(verified = "24.19.0") {
  return {
    kind: "node" as const,
    name: "node",
    verified,
    unverified: false,
    profiles: [] as string[],
  };
}

export const FIXED_NOW = new Date("2026-10-03T12:00:00Z");
export const FIXED_DAY = "2026-10-03";

// ---------------------------------------------------------------------------
// 列をそろえた表（note）の検査の道具
//
// 想定する形（#33 利用者の動作確認の反映）
//   note のタイトル "バージョンの調査結果"：先頭の行が見出し「パッケージ 検証済み 最新 差 範囲」（列の間は空白）、
//     続けてパッケージごとに 1 行。表が終わったら空行を1つ入れ、その下に警告・取得できない理由を別の行で出す
//     差：「同じ」「小」（小さな版の違い）「大」（大きな版の違い）「未確認」（取得できない）「範囲外」（範囲に合う安定版なし）
//     範囲：Target.range（なければ空）
//   note のタイトル "採用するバージョン"：見出し「パッケージ 採用 理由」、続けてパッケージごとに 1 行（理由は短い言葉）
//   列は表示の幅でそろえる。全角（日本語）は 2、半角は 1 として数える。
//     「小」「大」「未確認」「範囲外」は日本語なので幅 2 ずつ
//   各行の表示の幅は 80 以下。パッケージ名が長すぎる行だけは、省略せず（… などで欠けさせず）次の列を詰めてよい
// ---------------------------------------------------------------------------

/** 表示の幅（全角は 2、半角は 1） */
export function displayWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += isWide(ch) ? 2 : 1;
  return w;
}

function isWide(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0;
  return (
    (c >= 0x1100 && c <= 0x115f) ||
    (c >= 0x2e80 && c <= 0xa4cf) ||
    (c >= 0xac00 && c <= 0xd7a3) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xfe30 && c <= 0xfe6f) ||
    (c >= 0xff00 && c <= 0xff60) ||
    (c >= 0xffe0 && c <= 0xffe6)
  );
}

/** 1 行を、表示の幅 1 ごとの枠に並べる（全角の 2 つ目の枠は ""） */
function slotsOf(line: string): string[] {
  const slots: string[] = [];
  for (const ch of line) {
    slots.push(ch);
    if (isWide(ch)) slots.push("");
  }
  return slots;
}

/** 見出しの行から、各列の開始位置（表示の幅）を求める */
export function columnStarts(header: string): number[] {
  const starts: number[] = [];
  const slots = slotsOf(header);
  slots.forEach((s, i) => {
    if (s !== " " && s !== "" && (i === 0 || slots[i - 1] === " ")) starts.push(i);
  });
  return starts;
}

/** 行を、列の開始位置で切って、各列の文字列（前後の空白なし）にする */
export function cellsAt(line: string, starts: number[]): string[] {
  const slots = slotsOf(line);
  return starts.map((s, i) => {
    const end = i + 1 < starts.length ? (starts[i + 1] ?? slots.length) : slots.length;
    return slots.slice(s, end).join("").trim();
  });
}

/** 列がそろっていない行の説明（なければ空）。最後の列だけは空でもよい */
export function alignmentProblems(lines: string[], starts: number[]): string[] {
  const problems: string[] = [];
  for (const line of lines) {
    const slots = slotsOf(line);
    starts.forEach((s, i) => {
      if (i === 0) {
        if (slots[0] === " " || slots[0] === undefined) problems.push(`先頭の列が空：${line}`);
        return;
      }
      const last = i === starts.length - 1;
      const here = slots[s];
      const empty = here === undefined || here === " ";
      if (slots[s - 1] !== " " && slots[s - 1] !== undefined)
        problems.push(`列 ${i} の手前が空白でない：${line}`);
      if (empty && !last) problems.push(`列 ${i} が開始位置にない：${line}`);
      if (here === "") problems.push(`列 ${i} の開始位置が全角の途中：${line}`);
    });
  }
  return problems;
}

/** note の一覧（FakePrompter.notes）から、タイトルが title の note の表（空行まで）の行を返す。なければ例外 */
export function tableLines(
  notes: string[],
  title: string,
): { header: string; rows: string[]; rest: string[] } {
  const note = notes.find((n) => n.startsWith(`${title}\n`));
  if (!note)
    throw new Error(`タイトル「${title}」の note がありません：\n${notes.join("\n---\n")}`);
  const lines = note.split("\n").slice(1);
  const end = lines.findIndex((l) => l.trim() === "");
  const table = end === -1 ? lines : lines.slice(0, end);
  const rest = end === -1 ? [] : lines.slice(end + 1);
  const [header, ...rows] = table;
  if (header === undefined) throw new Error(`「${title}」の表が空です`);
  return { header, rows, rest };
}
