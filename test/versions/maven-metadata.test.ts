import { describe, expect, it } from "vitest";
import { parseMavenMetadata } from "../../src/versions/maven-metadata.js";
import { metadataXml } from "./maven-helpers.js";

describe("#39 AC-2: maven-metadata.xml の読み取り", () => {
  it("<versions> の <version> を、書かれた順に集める（<latest>・<release> は使わない）", () => {
    const xml = metadataXml("com.example", "demo-lib", ["1.0.0", "1.1.0", "2.0.0-RC1"]);
    expect(parseMavenMetadata(xml)).toEqual({
      ok: true,
      versions: ["1.0.0", "1.1.0", "2.0.0-RC1"],
    });
  });

  it("コメントの中の <version> は数えない", () => {
    const xml = `<metadata><versioning><versions>
      <!-- <version>9.9.9</version> -->
      <version>1.0.0</version>
    </versions></versioning></metadata>`;
    expect(parseMavenMetadata(xml)).toEqual({ ok: true, versions: ["1.0.0"] });
  });

  it("CDATA の中の <version> は数えない", () => {
    const xml = `<metadata><versioning><versions>
      <![CDATA[ <version>9.9.9</version> ]]>
      <version>1.0.0</version>
    </versions></versioning></metadata>`;
    expect(parseMavenMetadata(xml)).toEqual({ ok: true, versions: ["1.0.0"] });
  });

  it("実体参照5つだけを戻す（&amp;lt; は &lt; になる）", () => {
    const xml = `<metadata><versioning><versions>
      <version>1.0&amp;x</version><version>&lt;&gt;&quot;&apos;</version><version>&amp;lt;</version>
    </versions></versioning></metadata>`;
    expect(parseMavenMetadata(xml)).toEqual({ ok: true, versions: ["1.0&x", "<>\"'", "&lt;"] });
  });

  it("<versions> の外の <version>（<snapshotVersions> など）は数えない", () => {
    const xml = `<metadata><versioning>
      <snapshotVersions><snapshotVersion><version>7.7.7</version></snapshotVersion></snapshotVersions>
      <versions><version>1.0.0</version></versions>
    </versioning></metadata>`;
    expect(parseMavenMetadata(xml)).toEqual({ ok: true, versions: ["1.0.0"] });
  });

  it("版が0件なら ok: false", () => {
    const result = parseMavenMetadata(metadataXml("com.example", "demo-lib", []));
    expect(result.ok).toBe(false);
  });

  it("<metadata> が無い（壊れた XML・別の文書）なら ok: false。理由に本文を含めない", () => {
    for (const body of ["<html>not found</html>", "", "<versions><version>1.0</version>"]) {
      const result = parseMavenMetadata(body);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain("登録情報の形が想定と違います");
        expect(result.reason).not.toContain("html");
      }
    }
  });
});
