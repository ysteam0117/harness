// テストが --remote で Cloudflare 上の資源を使わないことを確認（C-40）。
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const seenScripts = new Set();
const seenFiles = new Set();
const violations = new Set();
const remote = /--remote(?:[=\s"'`]|$)/;

function inspectFile(file) {
  const resolved = path.resolve(file);
  const candidates = path.extname(resolved)
    ? [resolved]
    : [
        resolved,
        ...["ts", "tsx", "js", "mjs", "cjs", "mts", "cts"].flatMap(
          (extension) => [
            `${resolved}.${extension}`,
            path.join(resolved, `index.${extension}`),
          ],
        ),
      ];
  const absolute = candidates.find((candidate) => existsSync(candidate));
  if (!absolute) return;
  if (seenFiles.has(absolute) || !existsSync(absolute)) return;
  seenFiles.add(absolute);
  if (absolute === path.resolve("scripts/test-safety.mjs")) return;
  const text = readFileSync(absolute, "utf8");
  if (remote.test(text)) violations.add(file);
  for (const match of text.matchAll(
    /(?:from\s*|import\s*\(|require\s*\()\s*["'](\.\.?\/[^"']+)["']/g,
  )) {
    inspectFile(path.resolve(path.dirname(absolute), match[1]));
  }
  for (const match of text.matchAll(
    /(?:^|[;\n])\s*import\s*["'](\.\.?\/[^"']+)["']/g,
  )) {
    inspectFile(path.resolve(path.dirname(absolute), match[1]));
  }
}

function inspectCommand(text, label) {
  if (remote.test(text)) violations.add(label);
  for (const match of text.matchAll(
    /\bnpm(?:\.cmd)?(?:\s+--?[\w-]+(?:=[^\s;&|]+)?)*\s+(?:run(?:\s+--?[\w-]+(?:=[^\s;&|]+)?)*\s+([\w:-]+)|test\b)/gi,
  ))
    inspectScript(match[1] ?? "test");
  for (const match of text.matchAll(
    /(?:scripts\/[^\s"']+\.(?:mjs|js|ts)|[\w.-]+\.config\.(?:ts|mjs|js))/g,
  ))
    inspectFile(match[0]);
}

function inspectScript(name) {
  if (seenScripts.has(name)) return;
  seenScripts.add(name);
  for (const candidate of [`pre${name}`, name, `post${name}`]) {
    if (pkg.scripts?.[candidate])
      inspectCommand(pkg.scripts[candidate], candidate);
  }
}

for (const name of Object.keys(pkg.scripts ?? {}))
  if (name === "test" || name.startsWith("test:")) inspectScript(name);
for (const file of ["vitest.config.ts", "playwright.config.ts"])
  inspectFile(file);
if (violations.size) {
  console.error(
    `テストで --remote は使えません：${[...violations].sort().join(", ")}`,
  );
  process.exitCode = 1;
} else console.log("テストのコマンド：remote の指定はありません。");
