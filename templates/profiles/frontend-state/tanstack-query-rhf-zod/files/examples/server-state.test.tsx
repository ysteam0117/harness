// Skill「frontend-state」の例：サーバーのデータの扱い（コピーしない・更新後に取り直す・4つの状態）。
// Skill の書き方の例なので、消さない。ハーネスが管理するファイルで、ハーネスの更新で置き換わる。
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { apiClient } from "../services/api-client";
import { server } from "../test/server";

type Recipe = { id: number; title: string };
const recipeKeys = { all: ["recipes"] as const };
const fetchRecipes = async () =>
  (await apiClient.get<Recipe[]>("/recipes")).data;
const addRecipe = (title: string) => apiClient.post("/recipes", { title });

// #region example:server-data-as-is
export function RecipeList() {
  const { data } = useQuery({
    queryKey: recipeKeys.all,
    queryFn: fetchRecipes,
  });
  // サーバーのデータは、useQuery の data をそのまま表示する（useState にコピーしない）
  return (
    <ul>
      {data?.map((recipe) => (
        <li key={recipe.id}>{recipe.title}</li>
      ))}
    </ul>
  );
}
// #endregion

// #region example:state-copy-bad
export function RecipeListCopyBad() {
  const { data } = useQuery({
    queryKey: recipeKeys.all,
    queryFn: fetchRecipes,
  });
  return data ? <CopiedList initial={data} /> : null;
}

function CopiedList({ initial }: { initial: Recipe[] }) {
  // 悪い例：データを useState の初期値にコピーしている。取り直しても、表示は古いまま
  const [recipes] = useState(initial);
  return (
    <ul>
      {recipes.map((recipe) => (
        <li key={recipe.id}>{recipe.title}</li>
      ))}
    </ul>
  );
}
// #endregion

// #region example:invalidate-after-update
export function useAddRecipe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: addRecipe,
    // 更新が成功したら、関係するデータを取り直す（再読み込みせずに、表示が最新になる）
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: recipeKeys.all }),
  });
}
// #endregion

// #region example:no-invalidate-bad
export function useAddRecipeBad() {
  // 悪い例：更新が成功しても、データを取り直さない。一覧は古いまま
  return useMutation({ mutationFn: addRecipe });
}
// #endregion

// #region example:four-states
export function RecipeListWithStates() {
  const { data, error, isPending } = useQuery({
    queryKey: recipeKeys.all,
    queryFn: fetchRecipes,
  });
  if (isPending) return <p>読み込み中です</p>;
  if (error) return <p role="alert">レシピを取得できませんでした</p>;
  if (data.length === 0) return <p>レシピはまだありません</p>;
  return (
    <ul>
      {data.map((recipe) => (
        <li key={recipe.id}>{recipe.title}</li>
      ))}
    </ul>
  );
}
// #endregion

// #region example:no-error-state-bad
export function RecipeListWithoutErrorBad() {
  const { data } = useQuery({
    queryKey: recipeKeys.all,
    queryFn: fetchRecipes,
  });
  // 悪い例：エラーの表示がない。取得に失敗しても、データなしと同じ画面になる
  return (
    <ul>
      {data?.map((recipe) => (
        <li key={recipe.id}>{recipe.title}</li>
      ))}
    </ul>
  );
}
// #endregion

let recipes: Recipe[] = [];
function setupRecipeApi(initial: Recipe[]) {
  recipes = initial;
  server.use(
    http.get("/api/recipes", () => HttpResponse.json(recipes)),
    http.post("/api/recipes", async ({ request }) => {
      const { title } = (await request.json()) as { title: string };
      recipes = [...recipes, { id: recipes.length + 1, title }];
      return HttpResponse.json({ ok: true }, { status: 201 });
    }),
  );
}

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  return client;
}

describe("サーバーのデータをコピーしない", () => {
  const first = [{ id: 1, title: "testrecipe_001" }];
  const second = [{ id: 1, title: "testrecipe_001（更新）" }];

  it("良い例：データが取り直されると、表示も新しくなる", async () => {
    setupRecipeApi(first);
    const client = renderWithQuery(<RecipeList />);
    await screen.findByText("testrecipe_001");
    recipes = second;
    await act(() => client.invalidateQueries());
    expect(await screen.findByText("testrecipe_001（更新）")).toBeTruthy();
  });

  it("悪い例の問題：コピーした表示は、データが取り直されても古いまま", async () => {
    setupRecipeApi(first);
    const client = renderWithQuery(<RecipeListCopyBad />);
    await screen.findByText("testrecipe_001");
    recipes = second;
    await act(() => client.invalidateQueries());
    expect(client.getQueryData<Recipe[]>(recipeKeys.all)).toEqual(second);
    expect(screen.queryByText("testrecipe_001（更新）")).toBeNull();
  });
});

function Board({ useAdd }: { useAdd: typeof useAddRecipe }) {
  const add = useAdd();
  return (
    <>
      <button onClick={() => add.mutate("testrecipe_002")}>追加</button>
      {add.isSuccess && <p>追加しました</p>}
      <RecipeList />
    </>
  );
}

describe("更新の後にデータを取り直す", () => {
  it("良い例：追加すると、再読み込みせずに一覧に出る", async () => {
    setupRecipeApi([{ id: 1, title: "testrecipe_001" }]);
    renderWithQuery(<Board useAdd={useAddRecipe} />);
    await screen.findByText("testrecipe_001");
    await userEvent.click(screen.getByRole("button", { name: "追加" }));
    expect(await screen.findByText("testrecipe_002")).toBeTruthy();
  });

  it("悪い例の問題：追加が成功しても、一覧には出ない", async () => {
    setupRecipeApi([{ id: 1, title: "testrecipe_001" }]);
    renderWithQuery(<Board useAdd={useAddRecipeBad} />);
    await screen.findByText("testrecipe_001");
    await userEvent.click(screen.getByRole("button", { name: "追加" }));
    await screen.findByText("追加しました");
    expect(recipes).toHaveLength(2);
    expect(screen.queryByText("testrecipe_002")).toBeNull();
  });
});

describe("4つの状態を表示し分ける", () => {
  it("良い例：読み込み中・データなし・データあり・エラーを、それぞれ表示する", async () => {
    setupRecipeApi([]);
    renderWithQuery(<RecipeListWithStates />);
    expect(screen.getByText("読み込み中です")).toBeTruthy();
    expect(await screen.findByText("レシピはまだありません")).toBeTruthy();
  });

  it("良い例：データがあれば一覧を、取得に失敗すればエラーを表示する", async () => {
    setupRecipeApi([{ id: 1, title: "testrecipe_001" }]);
    renderWithQuery(<RecipeListWithStates />);
    expect(await screen.findByText("testrecipe_001")).toBeTruthy();
    server.use(
      http.get("/api/recipes", () => new HttpResponse(null, { status: 500 })),
    );
    renderWithQuery(<RecipeListWithStates />);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "取得できませんでした",
    );
  });

  it("悪い例の問題：取得に失敗しても、エラーの表示が出ない（利用者に伝わらない）", async () => {
    server.use(
      http.get("/api/recipes", () => new HttpResponse(null, { status: 500 })),
    );
    const client = renderWithQuery(<RecipeListWithoutErrorBad />);
    await waitFor(() =>
      expect(client.getQueryState(recipeKeys.all)?.status).toBe("error"),
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/取得できませんでした/)).toBeNull();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });
});
