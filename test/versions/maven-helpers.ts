// #39 テスト共通の道具：Maven Central と Adoptium の偽の登録情報（本物のネットワークにはつながない。座標は架空）。

export type MavenGiven = string | Error | number | "hang";

export interface MavenFakeSpec {
  /** 座標（group:artifact）→ maven-metadata.xml の本文 | Error（つながらない） | HTTP の状態 | "hang" */
  maven?: Record<string, MavenGiven>;
  /** Adoptium の available_releases の本文（オブジェクトは JSON にする） */
  java?: unknown | Error | number | "hang";
  /** 1回の応答までの遅れ（ミリ秒） */
  delayMs?: number;
}

export interface MavenFake {
  fn: typeof fetch;
  urls(): string[];
  readonly maxInFlight: number;
}

export const MAVEN_BASE = "https://repo1.maven.org/maven2/";
export const ADOPTIUM_URL = "https://api.adoptium.net/v3/info/available_releases";

/** maven-metadata.xml の本文を作る */
export function metadataXml(group: string, artifact: string, versions: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<metadata>
  <groupId>${group}</groupId>
  <artifactId>${artifact}</artifactId>
  <versioning>
    <latest>${versions[versions.length - 1] ?? ""}</latest>
    <release>${versions[versions.length - 1] ?? ""}</release>
    <versions>
${versions.map((v) => `      <version>${v}</version>`).join("\n")}
    </versions>
  </versioning>
</metadata>
`;
}

/** 座標 → URL（テストの期待値を、実装を使わずに作る） */
export function expectedMavenUrl(group: string, artifact: string): string {
  return `${MAVEN_BASE}${group.split(".").join("/")}/${artifact}/maven-metadata.xml`;
}

export function fakeMaven(spec: MavenFakeSpec = {}): MavenFake {
  const urls: string[] = [];
  let inFlight = 0;
  const stat = { max: 0 };
  const lookup = new Map<string, MavenGiven>();
  for (const [coordinate, given] of Object.entries(spec.maven ?? {})) {
    const [group = "", artifact = ""] = coordinate.split(":");
    lookup.set(expectedMavenUrl(group, artifact), given);
  }

  const respond = async (
    given: unknown,
    signal: AbortSignal | undefined,
    json: boolean,
  ): Promise<Response> => {
    if (given === "hang") {
      return new Promise<Response>((_, reject) => {
        signal?.addEventListener("abort", () =>
          reject(new DOMException("The operation was aborted", "AbortError")),
        );
      });
    }
    if (given instanceof Error) throw given;
    if (typeof given === "number") return new Response("error", { status: given });
    return new Response(json ? JSON.stringify(given) : String(given), { status: 200 });
  };

  const fn = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input);
    urls.push(url);
    inFlight++;
    stat.max = Math.max(stat.max, inFlight);
    try {
      if (spec.delayMs) await new Promise((r) => setTimeout(r, spec.delayMs));
      const signal = init?.signal ?? undefined;
      if (url === ADOPTIUM_URL) return await respond(spec.java ?? {}, signal, true);
      if (url.startsWith(MAVEN_BASE)) {
        const given = lookup.get(url);
        if (given === undefined) return new Response("not found", { status: 404 });
        return await respond(given, signal, false);
      }
      throw new Error(`想定外の URL です：${url}`);
    } finally {
      inFlight--;
    }
  }) as typeof fetch;

  return {
    fn,
    urls: () => urls,
    get maxInFlight() {
      return stat.max;
    },
  };
}
