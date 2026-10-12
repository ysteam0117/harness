// Maven Central の maven-metadata.xml から、版の一覧を読む。<latest>・<release> は使わない（版の一覧だけを信じる）。

export type MavenMetadataResult = { ok: true; versions: string[] } | { ok: false; reason: string };

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};

/** 実体参照 5つだけを戻す（1回の置き換えで、&amp;lt; が < にならないようにする） */
function unescapeEntities(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|apos);/g, (m) => ENTITIES[m] ?? m);
}

const SHAPE = "登録情報の形が想定と違います";

/** コメントと CDATA を除いてから、<versioning><versions> の <version> を集める */
export function parseMavenMetadata(xml: string): MavenMetadataResult {
  const plain = xml.replace(/<!--[\s\S]*?-->/g, "").replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
  if (!/<metadata[\s>]/.test(plain)) {
    return { ok: false, reason: `${SHAPE}（metadata がありません）` };
  }
  const versioning = /<versioning>([\s\S]*?)<\/versioning>/.exec(plain)?.[1];
  const block =
    versioning === undefined ? undefined : /<versions>([\s\S]*?)<\/versions>/.exec(versioning)?.[1];
  const versions: string[] = [];
  if (block !== undefined) {
    for (const m of block.matchAll(/<version>([^<]*)<\/version>/g)) {
      const version = unescapeEntities(m[1] ?? "").trim();
      if (version !== "") versions.push(version);
    }
  }
  if (versions.length === 0) return { ok: false, reason: `${SHAPE}（版がありません）` };
  return { ok: true, versions };
}
