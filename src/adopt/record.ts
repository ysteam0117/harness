// config.yaml の detected_stack・profiles の記録と読み戻し（Issue #18）。
// 記録するのは、分類・技術・版・根拠のファイルだけ（依存の名前の一覧・ファイルの中身・値は記録しない）。
// 形が誤っていても、読むときは止めない（無いものとして扱う）。
import { isPlainObject } from "../generate/data.js";
import {
  CLASS_ORDER,
  type DetectClass,
  type DetectedItem,
  type DetectNote,
  type NoProfile,
  type ProfileMatch,
} from "./detect.js";

export interface RecordedItem {
  category: DetectClass;
  technology: string;
  version?: string;
  evidence: string[];
}

export interface RecordedStack {
  apps: { dir: string; items: RecordedItem[] }[];
  notes: DetectNote[];
}

/** 判定の結果（detectStack の結果、または記録）を、config.yaml に書く形にする。項目のないフォルダは省く */
export function detectedStackEntry(stack: {
  apps: { dir: string; items: (DetectedItem | RecordedItem)[] }[];
  notes: DetectNote[];
}): RecordedStack {
  return {
    apps: stack.apps
      .filter((a) => a.items.length > 0)
      .map((a) => ({
        dir: a.dir,
        items: a.items.map((i) => ({
          category: "class" in i ? i.class : i.category,
          technology: i.technology,
          ...(i.version !== undefined ? { version: i.version } : {}),
          evidence: [...i.evidence],
        })),
      })),
    notes: stack.notes.map((n) => ({ path: n.path, reason: n.reason })),
  };
}

/** プロファイルの判定の結果を、config.yaml に書く形にする */
export function profilesEntry(match: ProfileMatch): ProfileMatch {
  return {
    applied: match.applied.map((a) => ({ profile: a.profile, apps: [...a.apps] })),
    none: match.none.map((n) => ({
      category: n.category,
      technology: n.technology,
      apps: [...n.apps],
      ...(n.partial !== undefined && n.partial.length > 0 ? { partial: [...n.partial] } : {}),
    })),
  };
}

const isString = (v: unknown): v is string => typeof v === "string";
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every(isString);
const isClass = (v: unknown): v is DetectClass => (CLASS_ORDER as readonly unknown[]).includes(v);

function readItem(raw: unknown): RecordedItem | undefined {
  if (!isPlainObject(raw)) return undefined;
  const { category, technology, version, evidence } = raw;
  if (!isClass(category) || !isString(technology) || !isStrings(evidence)) return undefined;
  if (version !== undefined && !isString(version)) return undefined;
  return { category, technology, ...(version !== undefined ? { version } : {}), evidence };
}

/** detected_stack の欄。形が正しいものだけ読む */
export function readDetectedStack(raw: unknown): RecordedStack | undefined {
  if (!isPlainObject(raw) || !Array.isArray(raw["apps"]) || !Array.isArray(raw["notes"])) {
    return undefined;
  }
  const apps: RecordedStack["apps"] = [];
  for (const a of raw["apps"] as unknown[]) {
    if (!isPlainObject(a) || !isString(a["dir"]) || !Array.isArray(a["items"])) return undefined;
    const items: RecordedItem[] = [];
    for (const i of a["items"] as unknown[]) {
      const item = readItem(i);
      if (item === undefined) return undefined;
      items.push(item);
    }
    apps.push({ dir: a["dir"], items });
  }
  const notes: DetectNote[] = [];
  for (const n of raw["notes"] as unknown[]) {
    if (!isPlainObject(n) || !isString(n["path"]) || !isString(n["reason"])) return undefined;
    notes.push({ path: n["path"], reason: n["reason"] });
  }
  return { apps, notes };
}

/** profiles の欄（applied・none）。形が正しいものだけ読む */
export function readProfiles(raw: unknown): ProfileMatch | undefined {
  if (!isPlainObject(raw) || !Array.isArray(raw["applied"]) || !Array.isArray(raw["none"])) {
    return undefined;
  }
  const applied: ProfileMatch["applied"] = [];
  for (const a of raw["applied"] as unknown[]) {
    if (!isPlainObject(a) || !isString(a["profile"]) || !isStrings(a["apps"])) return undefined;
    applied.push({ profile: a["profile"], apps: a["apps"] });
  }
  const none: NoProfile[] = [];
  for (const n of raw["none"] as unknown[]) {
    if (
      !isPlainObject(n) ||
      !isClass(n["category"]) ||
      !isString(n["technology"]) ||
      !isStrings(n["apps"])
    ) {
      return undefined;
    }
    const partial = n["partial"];
    if (partial !== undefined && !isStrings(partial)) return undefined;
    none.push({
      category: n["category"],
      technology: n["technology"],
      apps: n["apps"],
      ...(partial !== undefined && partial.length > 0 ? { partial } : {}),
    });
  }
  return { applied, none };
}
