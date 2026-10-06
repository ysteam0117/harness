// #42 smoke：品質チェックの2段（check＝ホスト、check:app＝コンテナの中）と、Docker が要ること（D1・DB なしも）。
//
// 想定する関数・定数（scripts/smoke-generated.ts が export する）
//   CONTAINER_CHECK_SCRIPT：コンテナの中で実行する品質チェックの script 名（check:app。Docker を使わない）
//   containerCheckShellCommand()：PostgreSQL の検証用コンテナの中で実行する sh -c の命令
//   containerCheckArgs()：D1・DB なしの backend コンテナの中で実行する npm の引数
//   decideDockerStep(available, env)："run" | "skip"。Docker がなければ "skip"。SMOKE_REQUIRE_DOCKER=1 のときは Error（日本語）
//        D1・DB なしも同じ（ホストの npm run check に、Docker で動くセキュリティのテストが入ったため）
import { describe, expect, it } from "vitest";
import {
  CONTAINER_CHECK_SCRIPT,
  containerCheckArgs,
  containerCheckShellCommand,
  decideDockerStep,
} from "../../scripts/smoke-generated.js";

describe("#42 smoke：コンテナの中の品質チェックは check:app", () => {
  it("script 名は check:app（Docker を使わない。check はホストで実行する）", () => {
    expect(CONTAINER_CHECK_SCRIPT).toBe("check:app");
  });

  it("PostgreSQL の検証用コンテナ：npm install の後に npm run check:app", () => {
    expect(containerCheckShellCommand()).toBe("npm install && npm run check:app");
  });

  it("D1・DB なしの backend コンテナ：docker exec に渡す npm の引数が check:app", () => {
    expect(containerCheckArgs()).toEqual(["npm", "run", "check:app"]);
  });
});

describe("#42 smoke：Docker が要る（D1・DB なしも）", () => {
  it("Docker があれば実行する", () => {
    expect(decideDockerStep(true, {})).toBe("run");
    expect(decideDockerStep(true, { SMOKE_REQUIRE_DOCKER: "1" })).toBe("run");
  });

  it("Docker がなければ飛ばす（D1・DB なしも。ホストの check がセキュリティのテストで失敗するため）", () => {
    expect(decideDockerStep(false, {})).toBe("skip");
  });

  it("SMOKE_REQUIRE_DOCKER=1 で Docker がなければ失敗にする", () => {
    expect(() => decideDockerStep(false, { SMOKE_REQUIRE_DOCKER: "1" })).toThrow(/Docker/);
  });
});
