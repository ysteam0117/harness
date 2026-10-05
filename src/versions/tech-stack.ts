import type { Profile } from "../generate/profile.js";
import { terraformVersions } from "../generate/values.js";
import type { VersionEntry, VersionResult } from "./choose.js";

/** 表のセルに入れる文字列（| と改行を無害にする） */
function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function latestCell(e: VersionEntry): string {
  if (e.latestStatus === "failed") return "未確認（取得できませんでした）";
  if (e.latestStatus === "none_in_range") return "範囲に合う安定版なし";
  return e.latestStable ?? "未確認（取得できませんでした）";
}

function row(e: VersionEntry): string {
  const cells = [
    e.name,
    e.version,
    e.reason,
    e.surveyedOn,
    latestCell(e),
    e.verified ?? "なし（ハーネスで未検証）",
  ];
  return `| ${cells.map(cell).join(" | ")} |`;
}

/**
 * docs/tech-stack.md の中身（Markdown）を作る。書き込みは #34。
 * 同じ入力なら同じ出力にする（日時などの揺れを入れない。調べた日は各行の surveyedOn）。
 */
export function renderTechStack(
  result: VersionResult,
  profiles: Pick<Profile, "key" | "name" | "compatibilityNotes">[],
): string {
  const lines: string[] = [
    "# 技術スタック",
    "",
    "採用したバージョンと、その選定理由の記録です。バージョンは、npm と Node.js の登録情報を調べて決めています。",
    "",
    "| 技術 | 採用したバージョン | 選定理由 | 調べた日 | 確認した最新の安定版 | 検証済み |",
    "| --- | --- | --- | --- | --- | --- |",
    ...result.entries.map(row),
    "",
    "- 検証済み：ハーネスのひな形で、動作を確かめたバージョン",
    "- 確認した最新の安定版：調べた日に、登録情報にあった最新の安定版（試験版を除く。範囲の条件があるものは、その範囲の中）",
    "- 未確認：登録情報を取得できず、最新の安定版を調べられなかったもの",
  ];

  const terraform = terraformVersions();
  lines.push(
    "",
    "## インフラ（Terraform、infra/）",
    "",
    "| 技術 | 版 | 固定する場所 |",
    "| --- | --- | --- |",
    `| Terraform | ${terraform.terraform} 以上 2.0.0 未満 | infra/versions.tf の required_version |`,
    `| Cloudflare プロバイダー（cloudflare/cloudflare、v5 系） | ${terraform.cloudflareProvider} | infra/versions.tf の required_providers（= で固定）。lock ファイルは README の手順で作ってコミットする |`,
    "",
    "- Terraform は npm では入れない。PC に直接入れる（infra/README.md）",
    "- プロバイダーの版は、ハーネスが、生成した infra/ で terraform init（-backend=false）と terraform validate を実行して確かめた版",
  );

  const major = result.entries.filter((e) => e.majorDiffers);
  if (major.length > 0) {
    lines.push("", "## 注意：大きな版が違うバージョン", "");
    for (const e of major) {
      lines.push(
        `- ${e.name}：検証済み ${e.verified ?? "なし"} に対して ${e.version} を採用しています。大きな版が違い、ハーネスで動作を確認していません`,
      );
    }
  }

  const noted = profiles.filter((p) => p.compatibilityNotes.length > 0);
  if (noted.length > 0) {
    lines.push("", "## 組み合わせの条件", "");
    for (const p of noted) {
      lines.push(`### ${p.name}（${p.key}）`, "");
      for (const note of p.compatibilityNotes) lines.push(`- ${note}`);
      lines.push("");
    }
    lines.pop();
  }
  return `${lines.join("\n")}\n`;
}
