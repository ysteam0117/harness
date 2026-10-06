import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gt, rcompare, valid } from "semver";

export interface ChangelogEntry {
  version: string;
  body: string;
}

const HEADING = /^##\s+\[?v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\]?/;

/** CHANGELOG.md を「## x.y.z」の見出しで分ける（ファイルに書かれた順） */
export function parseChangelog(text: string): ChangelogEntry[] {
  const entries: { version: string; lines: string[] }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = HEADING.exec(line);
    if (match?.[1] !== undefined) {
      entries.push({ version: match[1], lines: [] });
    } else if (entries.length > 0) {
      entries[entries.length - 1]?.lines.push(line);
    }
  }
  return entries.map((e) => ({ version: e.version, body: e.lines.join("\n").trim() }));
}

/** projectVersion より新しい項目（新しい順） */
export function changesSince(
  entries: readonly ChangelogEntry[],
  projectVersion: string,
): ChangelogEntry[] {
  if (valid(projectVersion) === null) return [];
  return entries
    .filter((e) => valid(e.version) !== null && gt(e.version, projectVersion))
    .sort((a, b) => rcompare(a.version, b.version));
}

/** 同梱の CHANGELOG.md。なければ undefined */
export function readBundledChangelog(): string | undefined {
  const file = fileURLToPath(new URL("../../CHANGELOG.md", import.meta.url));
  try {
    return readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}
