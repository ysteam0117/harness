import type { Answers } from "../questions/answers.js";

/** F-26 の判定の結果 */
export interface Judgment {
  /** ASVS のレベル。3 は「レベル3を検討」の意味（検討の結果は ADR に記録する） */
  asvsLevel: 1 | 2 | 3;
  /** ペネトレーションテストが必須か（C-82） */
  pentestRequired: boolean;
  /** 必須の理由（日本語の短い文。必須でなければ []） */
  pentestReasons: string[];
  /** 「未定」の質問の id（要件定義で決める項目） */
  undecided: string[];
  /** 有効にする共通仕様の番号（"C-14" の形。重複なし・昇順） */
  enabledRules: string[];
}

type Raw = Readonly<Record<string, unknown>>;

/** 質問A〜Gの id（要件定義で確かめる順） */
const QUESTION_IDS = [
  "personal_data",
  "admin",
  "critical_ops",
  "collaborative",
  "org_separation",
  "realtime",
  "availability",
] as const;

const UNDECIDED_NOTE = "未定のため、安全側として扱う";

/**
 * 回答（質問A〜G）から、ASVS のレベル・有効にするルール・ペネトレーションテストの要否を決める（F-26）。
 * 「未定」（回答がない場合も同じ）は、安全側（扱う・ある・する）として判定し、未定の一覧に入れる。
 * 認証（auth）が未定のときは、admin・collaborative を「なし」に決める条件（auth = none）が働かず、
 * 回答どおり未定のまま安全側になる（認証・アップロードは要件定義で決める。#79）。
 */
export function judge(answers: Answers): Judgment {
  const a = answers as unknown as Raw;
  const value = (id: string): string => {
    const v = a[id];
    return typeof v === "string" ? v : "undecided";
  };
  const undecided = QUESTION_IDS.filter((id) => value(id) === "undecided");
  const isUndecided = (id: string): boolean => value(id) === "undecided";

  let level: 1 | 2 | 3 = 1;
  const raise = (to: 1 | 2 | 3): void => {
    if (to > level) level = to;
  };
  const reasons: string[] = [];
  const rules = new Set<string>();
  const addRules = (...list: string[]): void => {
    for (const r of list) rules.add(r);
  };
  const reason = (text: string, id: string): void => {
    reasons.push(isUndecided(id) ? `${text}（${UNDECIDED_NOTE}）` : text);
  };

  // A 個人情報
  const personal = value("personal_data");
  if (personal !== "none") {
    raise(personal === "sensitive" ? 3 : 2);
    reason(
      personal === "sensitive" ? "特に配慮が必要な個人情報を扱う" : "個人情報を扱う",
      "personal_data",
    );
    addRules("C-09", "C-19", "C-30");
  }

  // B 管理者の機能
  if (value("admin") !== "no") {
    raise(2);
    reason("管理者の機能がある", "admin");
    addRules("C-14", "C-20", "C-30");
  }

  // C 重要な操作（決済があればレベル3を検討）
  if (value("critical_ops") !== "no") {
    const kinds = Array.isArray(a["critical_ops_kinds"]) ? a["critical_ops_kinds"] : [];
    raise(kinds.includes("payment") ? 3 : 2);
    reason(
      kinds.includes("payment") ? "決済を含む重要な操作がある" : "重要な操作がある",
      "critical_ops",
    );
    addRules("C-20", "C-66");
  }

  // D 共同編集（レベル・ペネトレーションテストには影響しない）
  if (value("collaborative") !== "no") addRules("C-14", "C-64");

  // E 組織ごとのデータ分離
  if (value("org_separation") !== "no") {
    reason("組織ごとにデータを分けている", "org_separation");
    addRules("C-14");
  }

  // F リアルタイムの更新
  if (value("realtime") !== "no") addRules("C-77");

  // G 可用性
  if (value("availability") !== "tolerant") addRules("C-79", "C-41");

  return {
    asvsLevel: level,
    pentestRequired: reasons.length > 0,
    pentestReasons: reasons,
    undecided: [...undecided],
    enabledRules: [...rules].sort(),
  };
}
