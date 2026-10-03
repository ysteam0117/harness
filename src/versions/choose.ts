import type { VersionChoice } from "../questions/answers.js";
import type { Prompter } from "../questions/prompter.js";
import { fetchVersionLists, type FetchResult } from "./registry.js";
import { compareWithVerified, pickLatestStable } from "./select.js";
import { alignTable } from "./table.js";
import type { Target } from "./targets.js";

/** 技術ごとの選定の結果（docs/tech-stack.md の1行になる） */
export interface VersionEntry {
  name: string;
  /** 採用した版 */
  version: string;
  /** 選定理由 */
  reason: string;
  /** 調べた日（YYYY-MM-DD） */
  surveyedOn: string;
  /** そのとき確認した最新の安定版（範囲内）。取得できなかった（未確認）なら null */
  latestStable: string | null;
  /** 最新の安定版の調査の結果：found（あった）｜none_in_range（取得できたが、範囲に合うものがない）｜failed（取得できなかった） */
  latestStatus: "found" | "none_in_range" | "failed";
  /** latestStatus が failed のとき、取得できなかった理由 */
  fetchFailure?: string;
  /** 検証済み。無ければ null */
  verified: string | null;
  /** 採用した版が検証済みより新しい */
  newerThanVerified: boolean;
  /** 採用した版が検証済みと大きな版（メジャー）が違う */
  majorDiffers: boolean;
}

export interface VersionResult {
  entries: VersionEntry[];
  /** 検証済みより新しい版を1つでも採用した（整合性チェックの事実） */
  newerThanVerified: boolean;
}

export type ChooseOutcome =
  { status: "ok"; result: VersionResult } | { status: "stopped"; message: string };

export interface ChooseOptions {
  targets: Target[];
  /** 質問16 version_policy */
  policy: "verified" | "latest";
  interactive: boolean;
  /** interactive が false のときは、入力（select・confirm）を使わない。表示（note）は使う */
  prompter: Prompter;
  fetch: typeof fetch;
  now: Date;
  /** --answers の versions（パッケージ名 → 選択） */
  versions?: Record<string, VersionChoice>;
  /** --answers の versions_offline */
  versionsOffline?: "verified";
  /** 既に選んだもの。対象にある名前は調べ直さずそのまま結果に入れ、対象にない名前は除く */
  keep?: VersionEntry[];
  timeoutMs?: number;
  concurrency?: number;
}

/** 1つの対象を調べた結果 */
interface Survey {
  target: Target;
  /** 取得できなかった理由（取得できたら undefined） */
  failure?: string;
  /** 範囲内の最新の安定版（なければ undefined） */
  latest?: string;
}

const OFFLINE_HINT =
  "検証済みのバージョンで進めるには、回答ファイルに versions_offline: verified を書いてください。";

function dayOf(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function label(name: string): string {
  return name === "node" ? "node（Node.js）" : name;
}

function rangeText(target: Target): string {
  return target.range !== undefined ? `（範囲 ${target.range}）` : "";
}

function surveyOf(target: Target, result: FetchResult | undefined): Survey {
  if (!result) return { target, failure: "取得の結果がありません" };
  if (!result.ok) return { target, failure: result.reason };
  const latest = pickLatestStable(result.versions, target.range);
  return latest === undefined ? { target } : { target, latest };
}

/** 検証済み｜最新の安定版｜差｜範囲 の表（列を表示の幅でそろえる） */
function formatTable(surveys: Survey[]): string {
  const rows = surveys.map(({ target, failure, latest }) => {
    let diff = "-";
    if (failure !== undefined) diff = "未確認";
    else if (latest === undefined) diff = "範囲外";
    else if (target.verified !== undefined) {
      const c = compareWithVerified(target.verified, latest);
      diff = c.kind === "same" ? "同じ" : c.majorDiffers ? "大" : c.kind === "newer" ? "小" : "古";
    }
    return [label(target.name), target.verified ?? "なし", latest ?? "-", diff, target.range ?? ""];
  });
  const table = alignTable(["パッケージ", "検証済み", "最新", "差", "使える範囲"], rows).join("\n");
  return `${table}\n\n使える範囲：組み合わせの都合で、使ってよいバージョンの条件（例：^4 は 4.x.x だけ）。空の行は制限なし`;
}

function failureLines(surveys: Survey[]): string[] {
  return surveys
    .filter((s) => s.failure !== undefined)
    .map((s) => `- ${label(s.target.name)}：${s.failure}`);
}

type Plan = { kind: VersionChoice; reason?: string };

function buildEntry(survey: Survey, plan: Plan, surveyedOn: string): VersionEntry {
  const { target, latest } = survey;
  const verified = target.verified ?? null;
  const latestStable = latest ?? null;
  let version: string;
  let reason: string;

  if (target.unverified || target.verified === undefined) {
    // 検証済みがない：戻せる版がないので、範囲内の最新の安定版（呼び出し側で、あることを確かめ済み）
    version = latest as string;
    reason = `ハーネスで未検証（範囲内の最新の安定版${rangeText(target)}）`;
  } else if (plan.kind === "latest" && latest !== undefined) {
    version = latest;
    reason =
      target.range !== undefined ? `範囲内の最新の安定版${rangeText(target)}` : "最新の安定版";
    if (target.kind === "node") reason = "最新の安定版（LTS）";
  } else if (plan.kind === "latest") {
    version = target.verified;
    reason =
      target.range !== undefined
        ? `範囲 ${target.range} に合う安定版がないため、ハーネス検証済みを使用`
        : "合う安定版がないため、ハーネス検証済みを使用";
  } else {
    version = target.verified;
    reason = plan.reason ?? "ハーネス検証済み";
  }

  let newerThanVerified = false;
  let majorDiffers = false;
  if (verified !== null) {
    const c = compareWithVerified(verified, version);
    newerThanVerified = c.kind === "newer";
    majorDiffers = c.majorDiffers;
  }
  return {
    name: target.name,
    version,
    reason,
    surveyedOn,
    latestStable,
    latestStatus:
      survey.failure !== undefined ? "failed" : latest !== undefined ? "found" : "none_in_range",
    ...(survey.failure !== undefined ? { fetchFailure: survey.failure } : {}),
    verified,
    newerThanVerified,
    majorDiffers,
  };
}

function warningNotes(entries: VersionEntry[], prompter: Prompter): void {
  const major = entries.filter((e) => e.majorDiffers);
  if (major.length > 0) {
    prompter.note(
      `${alignTable(
        ["パッケージ", "検証済み", "採用"],
        major.map((e) => [label(e.name), e.verified ?? "なし", e.version]),
      ).join("\n")}\n\nこれらは大きな版が違い、ハーネスで動作を確認していません`,
      "警告：大きな版が、検証済みと違います",
    );
  }
  const unverified = entries.filter((e) => e.verified === null);
  if (unverified.length > 0) {
    prompter.note(
      unverified
        .map(
          (e) =>
            `- ${label(e.name)}：採用 ${e.version}（ハーネスで未検証です。検証済みの版がありません）`,
        )
        .join("\n"),
      "警告：ハーネスで未検証のパッケージがあります",
    );
  }
}

/**
 * 調べて（F-19）、利用者の選択に従って、技術ごとの版を決める。
 * 方針にかかわらず最新の安定版を調べて記録する。方針 verified では、取得できなくても止めず「未確認」にする。
 */
export async function chooseVersions(opts: ChooseOptions): Promise<ChooseOutcome> {
  const { prompter } = opts;
  const surveyedOn = dayOf(opts.now);
  const kept = new Map((opts.keep ?? []).map((e) => [e.name, e]));
  const targets = opts.targets;
  const toSurvey = targets.filter((t) => !kept.has(t.name));

  const lists =
    toSurvey.length > 0
      ? await fetchVersionLists(toSurvey, opts.fetch, {
          ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
          ...(opts.concurrency !== undefined ? { concurrency: opts.concurrency } : {}),
        })
      : new Map<string, FetchResult>();
  const surveys = toSurvey.map((t) => surveyOf(t, lists.get(t.name)));
  if (surveys.length > 0) prompter.note(formatTable(surveys), "バージョンの調査結果");
  // 取得できなかった理由は、方針や versions の指定にかかわらず、失敗したすべてのパッケージについて示す
  const allFailed = surveys.filter((s) => s.failure !== undefined);
  if (allFailed.length > 0) {
    prompter.note(failureLines(allFailed).join("\n"), "最新の安定版を取得できなかったパッケージ");
  }

  // 検証済みのないパッケージは、戻せる版がない。取得できない・合う版がないときは進めない
  const stuck = surveys.filter(
    (s) => (s.target.unverified || s.target.verified === undefined) && s.latest === undefined,
  );
  if (stuck.length > 0) {
    const lines = stuck.map(
      (s) =>
        `- ${label(s.target.name)}：${s.failure ?? `範囲に合う安定版が登録情報にありません${rangeText(s.target)}`}`,
    );
    return {
      status: "stopped",
      message: `検証済みの版がないパッケージの最新の安定版を取得できないため、進められません（戻せる版がありません）。\n${lines.join("\n")}`,
    };
  }

  const explicit = opts.versions ?? {};
  const isFree = (s: Survey): boolean => !(s.target.unverified || s.target.verified === undefined);
  const failed = surveys.filter((s) => s.failure !== undefined && isFree(s));
  const plans = new Map<string, Plan>();
  const set = (s: Survey, plan: Plan): void => void plans.set(s.target.name, plan);
  const free = surveys.filter(isFree);

  if (opts.policy === "verified") {
    // 検証済みを採用する。取得できなくても止めず、最新の安定版は未確認にする
    for (const s of free) set(s, { kind: "verified" });
    if (failed.length > 0) {
      prompter.note(
        `最新の安定版を取得できなかったため、未確認として記録します（検証済みのバージョンで進みます）。`,
        "最新の安定版は未確認です",
      );
    }
  } else {
    // 取得できないものが、最新の安定版を選ぶ対象にあるか（利用者が検証済みを選んだものは除く）
    const needLatest = failed.filter((s) => explicit[s.target.name] !== "verified");
    let offlineAccepted = false;
    if (needLatest.length > 0) {
      const lines = failureLines(needLatest);
      if (!opts.interactive) {
        if (opts.versionsOffline !== "verified") {
          return {
            status: "stopped",
            message: `最新の安定版を取得できないパッケージがあります。\n${lines.join("\n")}\n${OFFLINE_HINT}`,
          };
        }
        prompter.note(
          `最新の安定版を取得できなかったため、検証済みのバージョンで進みます（versions_offline: verified）。`,
          "取得できないパッケージ",
        );
      } else {
        const go = await prompter.confirm({
          id: "versions_offline_confirm",
          message: "最新の安定版を取得できませんでした。検証済みのバージョンで進めますか",
          initialValue: true,
        });
        if (!go) {
          return {
            status: "stopped",
            message: `検証済みのバージョンで進めない場合は、ネットワークに接続してから、もう一度実行してください。\n${lines.join("\n")}`,
          };
        }
      }
      offlineAccepted = true;
    }

    // 方針 latest：何を選ぶか
    let mode: VersionChoice | "each" = "latest";
    const asked = free.filter((s) => explicit[s.target.name] === undefined);
    if (offlineAccepted) {
      mode = "verified";
    } else if (opts.interactive && asked.length > 0) {
      mode = await prompter.select<VersionChoice | "each">({
        id: "versions_mode",
        message: "どのバージョンを使いますか",
        options: [
          { value: "latest", label: "すべて最新の安定版（範囲内）" },
          { value: "verified", label: "すべて検証済み" },
          { value: "each", label: "技術ごとに選ぶ" },
        ],
        initialValue: "latest",
      });
    }
    for (const s of free) {
      const name = s.target.name;
      const fixed = explicit[name];
      if (s.failure !== undefined) {
        set(s, { kind: "verified" });
      } else if (fixed !== undefined) {
        set(s, { kind: fixed });
      } else if (mode === "each") {
        const pick = await prompter.select<VersionChoice>({
          id: `version_pick:${name}`,
          message: `${label(name)} のバージョン`,
          options: [
            { value: "latest", label: `最新の安定版（${s.latest ?? "合うものなし"}）` },
            { value: "verified", label: `検証済み（${s.target.verified ?? "なし"}）` },
          ],
          initialValue: "latest",
        });
        set(s, { kind: pick });
      } else {
        set(s, { kind: mode });
      }
    }
  }

  const surveyed = new Map(surveys.map((s) => [s.target.name, s]));
  const entries: VersionEntry[] = [];
  for (const target of targets) {
    const keptEntry = kept.get(target.name);
    if (keptEntry) {
      entries.push(keptEntry);
      continue;
    }
    const survey = surveyed.get(target.name) as Survey;
    entries.push(buildEntry(survey, plans.get(target.name) ?? { kind: "verified" }, surveyedOn));
  }

  warningNotes(
    entries.filter((e) => !kept.has(e.name)),
    prompter,
  );
  return {
    status: "ok",
    result: { entries, newerThanVerified: entries.some((e) => e.newerThanVerified) },
  };
}
