import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stringify } from "yaml";
import { CancelledError } from "../src/questions/prompter.js";
import { createProgram } from "../src/program.js";
import { FakePrompter, baseAnswers, cleanupTmp, makeTmp } from "./questions/helpers.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(rootDir, "package.json"), "utf8")) as {
  version: string;
};

const JAPANESE = /[ぁ-んァ-ヶ一-龠]/;

/** 実行して、標準出力・標準エラーに出た文字と、commander が投げたエラーを集める */
async function run(args: string[], deps?: Parameters<typeof createProgram>[0]) {
  const out: string[] = [];
  const err: string[] = [];
  const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    err.push(String(chunk));
    return true;
  });
  const errorSpy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    err.push(a.map(String).join(" ") + "\n");
  });
  const program = createProgram(deps);
  program.exitOverride();
  program.configureOutput({
    writeOut: (s) => out.push(s),
    writeErr: (s) => err.push(s),
  });
  let thrown: { exitCode?: number; code?: string } | undefined;
  try {
    await program.parseAsync(args, { from: "user" });
  } catch (e) {
    thrown = e as { exitCode?: number; code?: string };
  } finally {
    stderrSpy.mockRestore();
    errorSpy.mockRestore();
  }
  return { out: out.join(""), err: err.join(""), thrown };
}

beforeEach(() => {
  process.exitCode = undefined;
});
afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
  cleanupTmp();
});

describe("#30 AC-1: harness --help", () => {
  const help = createProgram().helpInformation();

  it("#30 AC-1: create・update・status の3つのコマンドが表示される", () => {
    expect(help).toContain("create");
    expect(help).toContain("update");
    expect(help).toContain("status");
  });

  it("#30 AC-1: 各コマンドの日本語の説明が表示される", () => {
    expect(help).toMatch(new RegExp(`create.*${JAPANESE.source}`));
    expect(help).toMatch(new RegExp(`update.*${JAPANESE.source}`));
    expect(help).toMatch(new RegExp(`status.*${JAPANESE.source}`));
  });

  it("#30 AC-1: 英語の見出し（Usage・Options・Commands）を含まない", () => {
    expect(help).not.toContain("Usage");
    expect(help).not.toContain("Options");
    expect(help).not.toContain("Commands");
  });
});

describe("#30 AC-1: 未実装のコマンド", () => {
  // create は #32 で実装された（動きは下の「#32 R5」で確かめる）
  for (const name of ["update", "status"]) {
    it(`#30 AC-1: ${name} は標準エラーに「未実装」の文言を出し、終了コードが1になる`, async () => {
      const { err, out } = await run([name]);
      expect(err).toContain("未実装");
      expect(out).not.toContain("未実装");
      expect(process.exitCode).toBe(1);
    });
  }
});

describe("#30 AC-1: 知らないコマンド", () => {
  it("#30 AC-1: 日本語のエラーと --help の案内を出し、終了コードが0以外になる", async () => {
    const { err, thrown } = await run(["unknown-command-xyz"]);
    expect(err).toMatch(JAPANESE);
    expect(err).toContain("--help");
    const code = thrown?.exitCode ?? process.exitCode ?? 0;
    expect(code).not.toBe(0);
  });
});

describe("#30 AC-1: --version", () => {
  it("#30 AC-1: package.json の version を出す", async () => {
    const { out, err } = await run(["--version"]);
    expect(out + err).toContain(pkg.version);
  });
});

describe("#30 AC-1: サブコマンドの --help", () => {
  for (const name of ["create", "update", "status"]) {
    it(`#30 AC-1: ${name} --help は日本語の見出しで、Usage・Options・Arguments を含まない`, async () => {
      const { out, err } = await run([name, "--help"]);
      const text = out + err;
      expect(text).toContain("使い方");
      expect(text).toContain("オプション");
      expect(text).not.toContain("Usage");
      expect(text).not.toContain("Options");
      expect(text).not.toContain("Arguments");
    });
  }

  it("#30 AC-1: create --help の --answers の説明が日本語", async () => {
    const { out, err } = await run(["create", "--help"]);
    const line = (out + err).split(/\r?\n/).find((l) => l.includes("--answers"));
    expect(line).toBeDefined();
    expect(line).toMatch(JAPANESE);
  });
});

describe("#30 AC-1: サブコマンドのオプションのエラー", () => {
  it("#30 AC-1: create --unknown は日本語のエラーと --help の案内を出し、終了コードが0以外", async () => {
    const { err, thrown } = await run(["create", "--unknown"]);
    expect(err).toMatch(JAPANESE);
    expect(err).toContain("--help");
    expect(thrown?.exitCode ?? process.exitCode ?? 0).not.toBe(0);
  });

  it("#30 AC-1: create --answers（値なし）は日本語のエラーになり、終了コードが0以外", async () => {
    const { err, thrown } = await run(["create", "--answers"]);
    expect(err).toMatch(JAPANESE);
    expect(err).not.toMatch(/error:/i);
    expect(thrown?.exitCode ?? process.exitCode ?? 0).not.toBe(0);
  });
});

describe("#30 AC-1: エラー本文の日本語化", () => {
  for (const name of ["create", "update", "status"]) {
    it(`#30 AC-1: ${name} --unknown は「知らないオプションです」とオプション名を含む`, async () => {
      const { err } = await run([name, "--unknown"]);
      expect(err).toContain("知らないオプションです");
      expect(err).toContain("--unknown");
    });
  }

  it("#30 AC-1: create --answers（値なし）は「オプションの値が指定されていません」と --answers を含み、argument missing を含まない", async () => {
    const { err } = await run(["create", "--answers"]);
    expect(err).toContain("オプションの値が指定されていません");
    expect(err).toContain("--answers");
    expect(err).not.toContain("argument missing");
  });
});

describe("#30 AC-1: コマンドの説明の文と使い方の行（F-28）", () => {
  const descriptions: Record<string, string> = {
    create: "質問に答えて、プロジェクトを生成する",
    update: "生成済みのプロジェクトに、新しいハーネスを反映する",
    status: "今のハーネスのバージョン・最新のバージョン・主な変更点を表示する",
  };

  for (const [name, text] of Object.entries(descriptions)) {
    it(`#30 AC-1: ${name} の説明の文が要件と完全に一致する`, () => {
      const cmd = createProgram().commands.find((c) => c.name() === name);
      expect(cmd?.description()).toBe(text);
      const line = createProgram()
        .helpInformation()
        .split(/\r?\n/)
        .find((l) => new RegExp(String.raw`^\s*${name}\b`).test(l));
      expect(line).toContain(text);
    });
  }

  it("#30 AC-1: ルートの --help の使い方の行は [オプション]・[コマンド] で、[options]・[command] を含まない", () => {
    const help = createProgram().helpInformation();
    expect(help).toContain("[オプション]");
    expect(help).toContain("[コマンド]");
    expect(help).not.toContain("[options]");
    expect(help).not.toContain("[command]");
  });

  it("#30 AC-1: create --help の使い方の行は [オプション] で、[options] を含まない", async () => {
    const { out, err } = await run(["create", "--help"]);
    const text = out + err;
    expect(text).toContain("[オプション]");
    expect(text).not.toContain("[options]");
  });
});

describe("#32 R5: create コマンド（CLI 経由）", () => {
  const okTools = async () => [
    { name: "node" as const, state: "ok" as const, version: "24.0.0" },
    { name: "git" as const, state: "ok" as const, version: "2.45.0" },
    { name: "docker" as const, state: "ok" as const, version: "27.0.1" },
  ];

  it("#32 AC-4: --answers の完全な YAML と --yes で、確認まで進み「生成は Issue #34 で実装予定です」で終了コード1。入力は求めない", async () => {
    const tmp = makeTmp();
    const file = path.join(tmp.inputDir, "answers.yaml");
    writeFileSync(file, stringify(baseAnswers()));
    const prompter = new FakePrompter({});
    const { err } = await run(["create", "--answers", file, "--yes"], {
      prompter,
      cwd: tmp.cwd,
      interactive: false,
      checkTools: okTools,
    });
    expect(err).toContain("生成は Issue #34 で実装予定です");
    expect(prompter.inputs).toHaveLength(0);
    expect(process.exitCode).toBe(1);
    expect(readdirSync(tmp.cwd)).toEqual([]);
  });

  it("#32 AC-1: --answers なしで、質問を始める（最初の質問は app_name）", async () => {
    const tmp = makeTmp();
    const prompter = new FakePrompter({ app_name: [new CancelledError()] });
    await run(["create"], { prompter, cwd: tmp.cwd, interactive: true, checkTools: okTools });
    expect(prompter.askedIds[0]).toBe("app_name");
  });

  it("#32 AC-5: 質問の途中で中断すると、「中断しました。ファイルは作成していません。」で終了コード130。ファイルは作られない", async () => {
    const tmp = makeTmp();
    const prompter = new FakePrompter({ app_name: ["testapp-001"], ais: [new CancelledError()] });
    const { err } = await run(["create"], {
      prompter,
      cwd: tmp.cwd,
      interactive: true,
      checkTools: okTools,
    });
    expect(err).toContain("中断しました。ファイルは作成していません。");
    expect(process.exitCode).toBe(130);
    expect(readdirSync(tmp.cwd)).toEqual([]);
  });

  it("#32 AC-4: create --help に --yes の日本語の説明がある", async () => {
    const { out, err } = await run(["create", "--help"]);
    const line = (out + err).split(/\r?\n/).find((l) => l.includes("--yes"));
    expect(line).toBeDefined();
    expect(line).toMatch(JAPANESE);
  });
});
