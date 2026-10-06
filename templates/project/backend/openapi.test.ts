// API の仕様書（docs/api/openapi.json）と、実際のルートの突き合わせ。
// API を足す・消す・変えるときは、同じ変更の中で仕様書も直す（食い違うと、このテストが失敗する）。
// 組み立ては backend/src/index.ts と同じ。DB につなぐ処理だけを、使わない代役にしている。index.ts にルートを足したら、ここにも足す。
import { describe, expect, it } from "vitest";
import spec from "../../docs/api/openapi.json";
import { createApp } from "./app";{{openapi_test_imports}}

{{openapi_test_app}}

const METHODS = ["get", "post", "put", "patch", "delete"];
const CHANGING = ["POST", "PUT", "PATCH", "DELETE"];

type Operation = { responses: Record<string, unknown> };

/** 仕様書の操作（名前は "GET /api/health" の形） */
const operations = Object.entries(spec.paths).flatMap(([path, item]) =>
  Object.entries(item as Record<string, Operation>)
    .filter(([method]) => METHODS.includes(method))
    .map(([method, operation]) => ({
      name: `${method.toUpperCase()} ${path}`,
      operation,
    })),
);

/** 実際のルート（ミドルウェアは除く） */
const actual = [
  ...new Set(
    app.routes
      .filter((route) => route.method !== "ALL")
      .map((route) => `${route.method} ${route.path}`),
  ),
].sort();

describe("API の仕様書（docs/api/openapi.json）", () => {
  it("実際のルートと、同じ操作が書かれている（足りない・余分がない）", () => {
    expect(operations.map((o) => o.name).sort()).toEqual(actual);
  });

  it("状態を変える操作は、送信元（Origin）が不正なときの 403 を書いている（C-28）", () => {
    const missing = operations
      .filter(({ name }) => CHANGING.includes(name.split(" ")[0] ?? ""))
      .filter(({ operation }) => !("403" in operation.responses))
      .map(({ name }) => name);
    expect(missing).toEqual([]);
  });

  it("認証が必要な API（/api/auth/）は、未認証の 401 を書いている", () => {
    const missing = operations
      .filter(({ name }) => name.includes(" /api/auth/"))
      .filter(({ operation }) => !("401" in operation.responses))
      .map(({ name }) => name);
    expect(missing).toEqual([]);
  });
});
