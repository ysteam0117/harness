// 秘密情報のファイルに、足りない項目がないかを確かめる（C-05・F-25）
// .env.example と実際のファイルの「項目の名前」だけを比べる。値は表示しない。
// 使い方：node scripts/env-check.mjs [確かめるファイル（既定は .env）]
import { readFileSync, existsSync } from "node:fs";

const EXAMPLE_FILE = ".env.example";
const targetFile = process.argv[2] ?? ".env";

function parseEntries(path) {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const index = line.indexOf("=");
      const key = line.slice(0, index).replace(/^export\s+/, "").trim();
      const isEmpty = line.slice(index + 1).trim() === "";
      return { key, isEmpty };
    });
}

if (!existsSync(EXAMPLE_FILE)) {
  console.error(`${EXAMPLE_FILE} が見つかりません。`);
  process.exit(2);
}
if (!existsSync(targetFile)) {
  console.error(
    `${targetFile} が見つかりません。${EXAMPLE_FILE} をコピーして作成し、値を入力してください（docs/secrets.md）。`,
  );
  process.exit(1);
}

const expected = parseEntries(EXAMPLE_FILE).map((entry) => entry.key);
const actual = new Map(parseEntries(targetFile).map((entry) => [entry.key, entry.isEmpty]));

const missing = expected.filter((key) => !actual.has(key));
const blank = expected.filter((key) => actual.get(key) === true);

if (missing.length === 0 && blank.length === 0) {
  console.log(`${targetFile}：足りない項目はありません。`);
  process.exit(0);
}
if (missing.length > 0) {
  console.log(`${targetFile} に無い項目：${missing.join(", ")}`);
}
if (blank.length > 0) {
  console.log(`${targetFile} で値が空の項目：${blank.join(", ")}`);
}
console.log("値は docs/secrets.md の手順で、利用者が入力してください。");
process.exit(1);
