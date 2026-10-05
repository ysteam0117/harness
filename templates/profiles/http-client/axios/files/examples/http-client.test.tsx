// Skill「http-client-axios」の例：API は apiClient だけで呼ぶ。失敗はもみ消さない。
// Skill の書き方の例なので、消さない。ハーネスが管理するファイルで、ハーネスの更新で置き換わる。
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import axios from "axios";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { apiClient } from "../services/api-client";
import { server } from "../test/server";

type Recipe = { id: number; title: string };

// #region example:use-api-client
export async function fetchRecipes(): Promise<Recipe[]> {
  // 共通の apiClient を使う。接続先・タイムアウト・リクエストID・エラーの変換が、決めたとおりに効く。
  // 失敗は ApiError として呼び出し元に届く（catch でもみ消さない）
  const response = await apiClient.get<Recipe[]>("/recipes");
  return response.data;
}
// #endregion

// #region example:direct-axios-bad
export async function fetchRecipesAxiosBad(): Promise<Recipe[]> {
  // 悪い例：axios を直接使っている。共通の設定が効かず、失敗も ApiError の形にならない
  const response = await axios.get<Recipe[]>("/api/recipes");
  return response.data;
}
// #endregion

// #region example:swallow-error-bad
export async function fetchRecipesSwallowBad(): Promise<Recipe[]> {
  try {
    const response = await apiClient.get<Recipe[]>("/recipes");
    return response.data;
  } catch {
    // 悪い例：失敗をもみ消して、空の一覧を返している。失敗が、データなしに見える
    return [];
  }
}
// #endregion

const failure = {
  code: "INTERNAL_ERROR",
  message: "サーバーで問題が起きました",
};
const serverFails = (onRequest?: (requestId: string | null) => void) =>
  server.use(
    http.get("/api/recipes", ({ request }) => {
      onRequest?.(request.headers.get("X-Request-Id"));
      return HttpResponse.json(failure, { status: 500 });
    }),
  );

describe("API は apiClient だけで呼ぶ", () => {
  it("良い例：リクエストIDが付き、失敗は ApiError の形で届く", async () => {
    let requestId: string | null = null;
    serverFails((id) => (requestId = id));
    const error = await fetchRecipes().catch((e: unknown) => e);
    expect(requestId).toBeTruthy();
    expect(error).toMatchObject({ status: 500, code: "INTERNAL_ERROR" });
  });

  it("悪い例の問題：リクエストIDが付かず、失敗も ApiError の形にならない", async () => {
    let requestId: string | null = "未受信";
    serverFails((id) => (requestId = id));
    const error = await fetchRecipesAxiosBad().catch((e: unknown) => e);
    expect(requestId).toBeNull();
    expect(axios.isAxiosError(error)).toBe(true);
    expect(error).not.toMatchObject({ code: "INTERNAL_ERROR" });
  });
});

function Titles({ fetcher }: { fetcher: () => Promise<Recipe[]> }) {
  const { data, error, isPending } = useQuery({
    queryKey: ["recipes"],
    queryFn: fetcher,
  });
  if (isPending) return <p>読み込み中です</p>;
  if (error) return <p role="alert">レシピを取得できませんでした</p>;
  if (data.length === 0) return <p>レシピはまだありません</p>;
  return <p>{data.length}件</p>;
}

function renderTitles(fetcher: () => Promise<Recipe[]>) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <Titles fetcher={fetcher} />
    </QueryClientProvider>,
  );
}

describe("失敗をもみ消さない", () => {
  it("良い例：サーバーの失敗は、エラーとして画面に伝わる", async () => {
    serverFails();
    renderTitles(fetchRecipes);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "取得できませんでした",
    );
  });

  it("悪い例の問題：サーバーが失敗しても「データなし」と表示され、失敗が伝わらない", async () => {
    serverFails();
    renderTitles(fetchRecipesSwallowBad);
    expect(await screen.findByText("レシピはまだありません")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
