// セキュリティのテスト（C-82）。Semgrep・gitleaks・OSV-Scanner を、Docker の公式イメージ（版とダイジェストで固定）で実行する。
// 使い方：node scripts/security-check.mjs [all|semgrep|secrets|osv]（npm run security・security:semgrep・security:secrets・security:osv）
// 1つでも失敗すると、終了コード1で終わる。スキップの環境変数は用意していない（抜け道を作らない）。
// 手順・合否の基準・抑止の決まりは docs/testing/security.md。
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// 固定したイメージ。確かめた日と方法は、ハーネスのプロファイル（container_images）にある
// 長い値でも、Prettier が行を折り返さないようにする（版を更新しても、書式の確認が変わらない）
// prettier-ignore
export const IMAGES = {
  semgrep: "{{semgrep_image}}",
  gitleaks: "{{gitleaks_image}}",
  osv: "{{osv_scanner_image}}",
};

/** CVSS の重大度（0〜10）の、この値以上を「高・重大」として失敗にする */
export const OSV_FAIL_SCORE = 7;

const GUIDE = "docs/testing/security.md";

/** Git に入れてはいけない秘密のファイルの名前（.env.example のような、項目の例だけのファイルは除く） */
export function isSecretFileName(filePath) {
  const name = filePath.split("/").pop() ?? "";
  if (name === ".env.example" || name.endsWith(".example")) return false;
  return /^\.env(\..+)?$/.test(name) || /^\.dev\.vars(\..+)?$/.test(name);
}

/** git ls-files -z の出力から、Git に入っている秘密のファイルの一覧を返す */
export function findTrackedSecretFiles(listOutput) {
  return listOutput
    .split("\0")
    .filter((file) => file !== "" && isSecretFileName(file));
}

/** docker run の引数。作業フォルダは読み取り専用で /src に置く */
export function dockerArgs(cwd, image, toolArgs, { network = true } = {}) {
  return [
    "run",
    "--rm",
    ...(network ? [] : ["--network", "none"]),
    "-v",
    `${cwd}:/src:ro`,
    "-w",
    "/src",
    image,
    ...toolArgs,
  ];
}

export const SEMGREP_ARGS = [
  "semgrep",
  "scan",
  "--config",
  "/src/.semgrep",
  "--severity",
  "ERROR",
  "--error",
  "--metrics=off",
  "--disable-version-check",
  "--exclude",
  "node_modules",
  "--exclude",
  "dist",
  "--exclude",
  ".wrangler",
  "/src",
];

export const GITLEAKS_ARGS = [
  "dir",
  "/src",
  "--config",
  "/src/.gitleaks.toml",
  "--redact",
  "--no-banner",
  "--exit-code",
  "1",
  "--report-format",
  "json",
  "--report-path",
  "-",
];

export const OSV_ARGS = [
  "scan",
  "source",
  "--lockfile",
  "/src/package-lock.json",
  "--format",
  "json",
];

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** package-lock.json のうち、開発でだけ使う依存（dev）の「名前@版」の集合。本番の依存にも入るものは含めない */
export function devOnlyPackages(lockText) {
  const lock = parseJson(lockText);
  const entries = Object.entries(lock?.packages ?? {}).filter(([location]) =>
    location.includes("node_modules/"),
  );
  const production = new Set();
  const development = new Set();
  for (const [location, info] of entries) {
    const name = location.slice(location.lastIndexOf("node_modules/") + 13);
    const key = `${name}@${info.version}`;
    (info.dev === true ? development : production).add(key);
  }
  return new Set([...development].filter((key) => !production.has(key)));
}

/** 1つのパッケージの指摘（グループごとの最大の重大度。グループにない指摘は重大度なし）の一覧 */
function osvRows(item) {
  const groups = item.groups ?? [];
  const grouped = new Set(groups.flatMap((group) => group.ids ?? []));
  const rows = groups.map((group) => ({
    id: group.ids?.[0] ?? "(id なし)",
    score: Number.parseFloat(group.max_severity),
  }));
  for (const vuln of item.vulnerabilities ?? []) {
    if (!grouped.has(vuln.id)) rows.push({ id: vuln.id, score: Number.NaN });
  }
  return rows;
}

/**
 * OSV-Scanner の JSON の結果を、失敗にするもの（高・重大）と、記録だけにするもの（重大度なし・7.0 未満）に分ける。
 * dev の依存は対象にしない。読めない形なら undefined。
 */
export function parseOsvReport(stdout, lockText) {
  const report = parseJson(stdout);
  if (report === undefined || !Array.isArray(report.results ?? [])) {
    return undefined;
  }
  const devOnly = devOnlyPackages(lockText);
  const failures = [];
  const recorded = [];
  const items = (report.results ?? []).flatMap(
    (result) => result.packages ?? [],
  );
  for (const item of items) {
    const { name, version } = item.package ?? {};
    if (devOnly.has(`${name}@${version}`)) continue;
    for (const row of osvRows(item)) {
      const found = { name, version, id: row.id, score: row.score };
      const high = !Number.isNaN(row.score) && row.score >= OSV_FAIL_SCORE;
      (high ? failures : recorded).push(found);
    }
  }
  return { failures, recorded };
}

/** gitleaks の JSON の結果から、場所だけを取り出す（値は読まない・出さない） */
export function summarizeLeaks(stdout) {
  const leaks = parseJson(stdout);
  if (!Array.isArray(leaks)) return undefined;
  return leaks.map((leak) => ({
    rule: String(leak.RuleID ?? "?"),
    file: String(leak.File ?? "?").replace(/^\/src\//, ""),
    line: Number(leak.StartLine ?? 0),
  }));
}

export function defaultRunner(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    stdio: options.capture
      ? ["ignore", "pipe", options.quiet ? "ignore" : "inherit"]
      : "inherit",
    maxBuffer: 256 * 1024 * 1024,
    windowsHide: true,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    error: result.error,
  };
}

/** docker が使えるか：ok・missing（入っていない）・stopped（動いていない） */
export function dockerState(runner, cwd) {
  const result = runner("docker", ["info"], {
    cwd,
    capture: true,
    quiet: true,
  });
  if (result.error !== undefined) return "missing";
  return result.status === 0 ? "ok" : "stopped";
}

const DOCKER_MESSAGES = {
  missing: "Docker が見つかりません。",
  stopped: "Docker が動いていません。",
};

function checkTrackedSecrets(runner, cwd) {
  const listed = runner("git", ["ls-files", "-z"], {
    cwd,
    capture: true,
    quiet: true,
  });
  if (listed.error !== undefined || listed.status !== 0) {
    return { ok: true, note: "Git のリポジトリではないため、飛ばしました" };
  }
  const files = findTrackedSecretFiles(listed.stdout);
  if (files.length === 0) return { ok: true };
  return {
    ok: false,
    lines: [
      "Git に入っている秘密のファイルがあります（値は表示しません）：",
      ...files.map((file) => `  - ${file}`),
      "git rm --cached <ファイル> で Git から外し、.gitignore に入っていることを確かめてください。すでにコミットした場合は、値を取り消して作り直してください",
    ],
  };
}

function runSemgrep(context) {
  const { runner, cwd, env } = context;
  const result = runner(
    "docker",
    dockerArgs(cwd, IMAGES.semgrep, SEMGREP_ARGS, { network: false }),
    { cwd, env },
  );
  if (result.error !== undefined) {
    return { ok: false, lines: ["Semgrep を実行できませんでした"] };
  }
  return {
    ok: result.status === 0,
    lines:
      result.status === 0
        ? []
        : [
            "Semgrep が、重大度が高い指摘（ERROR）を見つけたか、実行に失敗しました。上の出力を確かめてください",
            "誤検知は、該当の行に「// nosemgrep: <ルールの id> <理由>」を付けて抑えます（理由は必須）",
          ],
  };
}

function runGitleaks(context) {
  const { runner, cwd, env, log } = context;
  const result = runner(
    "docker",
    dockerArgs(cwd, IMAGES.gitleaks, GITLEAKS_ARGS, { network: false }),
    { cwd, env, capture: true },
  );
  if (result.error !== undefined) {
    return { ok: false, lines: ["gitleaks を実行できませんでした"] };
  }
  const leaks = summarizeLeaks(result.stdout);
  if (leaks === undefined) {
    return {
      ok: false,
      lines: [
        "gitleaks の結果を読めませんでした（実行の失敗の可能性があります）",
      ],
    };
  }
  if (leaks.length === 0 && result.status === 0) return { ok: true };
  if (leaks.length === 0) {
    return { ok: false, lines: ["gitleaks が失敗しました（終了コード）"] };
  }
  log("秘密情報らしいものが見つかりました（値は表示しません）：");
  for (const leak of leaks) {
    log(`  - ${leak.file}:${String(leak.line)}（ルール ${leak.rule}）`);
  }
  return {
    ok: false,
    lines: [
      "本物の秘密なら、取り消して作り直し、環境変数（.env）に移してください。テスト用の架空の値なら、値に FAKE_SECRET_FOR_TEST を含めます",
    ],
  };
}

function runOsv(context) {
  const { runner, cwd, env, readLock, log } = context;
  let lockText;
  try {
    lockText = readLock(path.join(cwd, "package-lock.json"));
  } catch {
    return {
      ok: false,
      lines: ["package-lock.json がありません。npm install で作ってください"],
    };
  }
  const result = runner(
    "docker",
    dockerArgs(cwd, IMAGES.osv, OSV_ARGS, { network: true }),
    {
      cwd,
      env,
      capture: true,
    },
  );
  const report =
    result.error === undefined && (result.status === 0 || result.status === 1)
      ? parseOsvReport(result.stdout, lockText)
      : undefined;
  if (report === undefined) {
    return {
      ok: false,
      lines: [
        "OSV-Scanner の結果を得られませんでした。脆弱性の検出ではなく、通信か実行の失敗です（OSV のデータベースへの通信が要ります）。通信を確かめて、もう一度実行してください",
      ],
    };
  }
  for (const item of report.recorded) {
    const score = Number.isNaN(item.score) ? "重大度なし" : String(item.score);
    log(
      `記録：${item.name}@${item.version} ${item.id}（${score}。失敗にはしません）`,
    );
  }
  if (report.failures.length === 0) return { ok: true };
  log("本番の依存に、高・重大の脆弱性があります：");
  for (const item of report.failures) {
    log(
      `  - ${item.name}@${item.version} ${item.id}（重大度 ${String(item.score)}）`,
    );
  }
  return {
    ok: false,
    lines: [
      "脆弱性のある依存を、直った版へ更新してください（検出の失敗：通信の失敗とは別です）",
    ],
  };
}

const TOOLS = [
  {
    id: "secrets",
    label: "gitleaks（秘密情報）",
    needsDocker: true,
    run: runGitleaks,
  },
  {
    id: "semgrep",
    label: "Semgrep（コードの書き方）",
    needsDocker: true,
    run: runSemgrep,
  },
  {
    id: "osv",
    label: "OSV-Scanner（依存の脆弱性）",
    needsDocker: true,
    run: runOsv,
  },
];

const GIT_FILES_LABEL = "Git に入った秘密のファイル";

const USAGE =
  "使い方：node scripts/security-check.mjs [all|semgrep|secrets|osv]";

function withDefaults(deps) {
  return {
    runner: deps.runner ?? defaultRunner,
    cwd: deps.cwd ?? process.cwd(),
    log: deps.log ?? ((line) => console.log(line)),
    now: deps.now ?? (() => Date.now()),
    env: { ...(deps.env ?? process.env), MSYS_NO_PATHCONV: "1" },
    readLock: deps.readLock ?? ((file) => readFileSync(file, "utf8")),
  };
}

/** Docker で動く道具を順に実行する。Docker が使えなければ、導入を案内して、すべて未実行（失敗）にする */
function runWithDocker(selected, context, record, rows) {
  const { runner, cwd, log, now } = context;
  const state = dockerState(runner, cwd);
  if (state !== "ok") {
    log(
      `${DOCKER_MESSAGES[state]} セキュリティのテストは、Docker の公式イメージで実行します。Docker Desktop（Windows・macOS）か Docker Engine（Linux）を入れて起動してから、もう一度実行してください（導入の手順：${GUIDE}）`,
    );
    for (const tool of selected) {
      rows.push({ label: tool.label, ms: 0, ok: false, skipped: true });
    }
    return;
  }
  for (const tool of selected) {
    log(`== ${tool.label} ==`);
    const started = now();
    record(tool.label, started, tool.run(context));
  }
}

/** 実行の本体。終了コードを返す（0：すべて合格） */
export function main(argv, deps = {}) {
  const context = withDefaults(deps);
  const { runner, cwd, log, now } = context;

  const wanted = argv[0] ?? "all";
  const selected =
    wanted === "all" ? TOOLS : TOOLS.filter((t) => t.id === wanted);
  if (selected.length === 0) {
    log(`${USAGE}（${wanted} は指定できません）`);
    return 1;
  }

  const rows = [];
  const record = (label, started, outcome) => {
    rows.push({ label, ms: now() - started, ok: outcome.ok });
    for (const line of outcome.lines ?? []) log(line);
    if (outcome.note !== undefined) log(outcome.note);
  };

  // Git に入った秘密のファイルは、Docker を使わず確かめる（秘密情報の確認と一緒に行う）
  if (wanted === "all" || wanted === "secrets") {
    record(GIT_FILES_LABEL, now(), checkTrackedSecrets(runner, cwd));
  }
  runWithDocker(selected, context, record, rows);
  printSummary(rows, log);
  return rows.every((row) => row.ok) ? 0 : 1;
}

function printSummary(rows, log) {
  log("== セキュリティのテストの要約 ==");
  for (const row of rows) {
    const mark = row.ok ? "OK" : "NG";
    const detail =
      row.skipped === true
        ? "未実行（Docker）"
        : `${(row.ms / 1000).toFixed(1)} 秒`;
    log(`${mark}  ${row.label}（${detail}）`);
  }
}

const entry = process.argv[1];
if (
  entry !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(entry)).href
) {
  process.exitCode = main(process.argv.slice(2));
}
