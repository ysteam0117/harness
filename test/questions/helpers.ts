// #32 テスト共通の道具（偽の Prompter・架空の回答・一時フォルダ）
//
// 想定する型（実装の役割はこの形に合わせる）
//
//   // src/questions/prompter.ts
//   export class CancelledError extends Error {}                 // Ctrl+C（@clack/prompts の isCancel が真）
//   export interface SelectOption<T extends string = string> { value: T; label: string; hint?: string }
//   export interface Prompter {
//     // 入力（利用者に聞く）。id は質問の id（確認などは "confirm_generate"・"accept_warning:<ruleId>"・"fix_question"）
//     text(o: { id: string; message: string; placeholder?: string; validate?: (v: string) => string | undefined }): Promise<string>;
//     select<T extends string>(o: { id: string; message: string; options: SelectOption<T>[]; initialValue?: T }): Promise<T>;
//     multiselect<T extends string>(o: { id: string; message: string; options: SelectOption<T>[]; required?: boolean }): Promise<T[]>;
//     confirm(o: { id: string; message: string; initialValue?: boolean }): Promise<boolean>;
//     // 表示（利用者に見せるだけ。入力ではない）
//     note(message: string, title?: string): void;
//   }
//   export function createClackPrompter(): Prompter;             // 本番（@clack/prompts）
//
//   // src/questions/answers.ts
//   export interface Answers { app_name: string; ais: ("claude"|"codex")[]; project_type: "web"; layers: "frontend_backend";
//     visibility: "public"|"private"; team_size: "solo"|"team"; frontend: "react"; backend: "hono"; infra: "cloudflare";
//     database: "d1"|"postgresql"|"none"; postgres_provider?: ...; data_access?: "drizzle"; auth: "none"|"app"|"oidc"|"both";
//     idp?: ...; personal_data: ...; admin: ...; critical_ops: ...; critical_ops_kinds?: ...[]; collaborative: ...;
//     org_separation: ...; realtime: ...; availability: ...; file_upload: "no"|"yes"; file_kinds?: ...[];
//     check_location: "local"|"github_actions"|"both"; version_policy: "verified"|"latest" }
//
// 偽の Prompter は、質問の id ごとに「返す値の列」を持つ。列が尽きた質問を聞かれたら失敗する（想定外の質問を検出する）。
// 値が Error のときはそれを投げる（CancelledError で Ctrl+C を再現する）。

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Prompter } from "../../src/questions/prompter.js";
import type { Answers } from "../../src/questions/answers.js";

export interface PromptEvent {
  type: "input" | "note";
  method?: "text" | "select" | "multiselect" | "confirm";
  id?: string;
  message: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  opts?: any;
}

export class FakePrompter implements Prompter {
  readonly events: PromptEvent[] = [];
  readonly rejections: { id: string; value: string; message: string }[] = [];
  private readonly script: Record<string, unknown[]>;

  constructor(script: Record<string, unknown[]> = {}) {
    this.script = Object.fromEntries(Object.entries(script).map(([k, v]) => [k, [...v]]));
  }

  /** 入力のやり取り（text・select・multiselect・confirm）だけ */
  get inputs(): PromptEvent[] {
    return this.events.filter((e) => e.type === "input");
  }
  /** 入力を聞かれた質問の id の並び */
  get askedIds(): (string | undefined)[] {
    return this.inputs.map((e) => e.id);
  }
  /** 表示（note）だけ */
  get notes(): string[] {
    return this.events.filter((e) => e.type === "note").map((e) => e.message);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private next(method: PromptEvent["method"], o: any): unknown {
    this.events.push({ type: "input", method, id: o.id, message: o.message, opts: o });
    const queue = this.script[o.id as string];
    if (!queue || queue.length === 0) {
      throw new Error(`想定外の入力です：${method} ${String(o.id)}`);
    }
    const value = queue.shift();
    if (value instanceof Error) throw value;
    return value;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async text(o: any): Promise<string> {
    for (;;) {
      const value = this.next("text", o) as string;
      const message = o.validate?.(value) as string | undefined;
      if (message) {
        this.rejections.push({ id: o.id, value, message });
        continue; // 本物は入力し直しになる
      }
      return value;
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async select(o: any): Promise<any> {
    return this.next("select", o);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async multiselect(o: any): Promise<any> {
    return this.next("multiselect", o);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async confirm(o: any): Promise<boolean> {
    return this.next("confirm", o) as boolean;
  }
  note(message: string, title?: string): void {
    this.events.push({ type: "note", message: title ? `${title}\n${message}` : message });
  }
}

/** 実在しない架空の回答（質問に全部答えた状態。自動で決まる質問は含めない） */
export function baseAnswers(over: Record<string, unknown> = {}): Partial<Answers> {
  return {
    app_name: "testapp-001",
    ais: ["claude"],
    visibility: "private",
    team_size: "solo",
    database: "d1",
    auth: "oidc",
    idp: "google",
    personal_data: "none",
    admin: "no",
    critical_ops: "no",
    collaborative: "no",
    org_separation: "no",
    realtime: "no",
    availability: "tolerant",
    file_upload: "no",
    check_location: "both",
    version_policy: "verified",
    ...over,
  } as unknown as Partial<Answers>;
}

/** 自動で決まる質問の値（初回の範囲） */
export const AUTO_VALUES = {
  project_type: "web",
  layers: "frontend_backend",
  frontend: "react",
  backend: "hono",
  infra: "cloudflare",
  data_access: "drizzle",
} as const;

/** 一時フォルダ（cwd 用と、回答ファイル用を分ける）。afterEach で cleanup を呼ぶ */
const made: string[] = [];
export function makeTmp(): { root: string; cwd: string; inputDir: string } {
  const root = mkdtempSync(path.join(os.tmpdir(), "harness-q32-"));
  const cwd = path.join(root, "work");
  const inputDir = path.join(root, "in");
  mkdirSync(cwd);
  mkdirSync(inputDir);
  made.push(root);
  return { root, cwd, inputDir };
}
export function cleanupTmp(): void {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}
