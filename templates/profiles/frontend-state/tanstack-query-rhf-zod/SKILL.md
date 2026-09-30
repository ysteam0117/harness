---
name: frontend-state
description: 画面の状態・サーバーのデータ・フォームの扱い方のルール。データの取得と更新、操作結果の即時反映、フォームの入力チェックを扱うときに読む。
---

<!-- もとになった共通仕様：C-45・C-47・C-48・C-77 -->

# 状態とフォーム（TanStack Query・React Hook Form・Zod）

作業の過程と結果は、すべて日本語で書く。

## サーバーのデータ（TanStack Query）

```ts
// features/recipes/api/query-keys.ts：クエリキーは機能ごとに1か所で定義する
export const recipeKeys = {
  all: ["recipes"] as const,
  detail: (id: number) => ["recipes", id] as const,
};

// 取得
const recipes = useQuery({ queryKey: recipeKeys.all, queryFn: fetchRecipes });

// 更新：成功したら関係するデータを取り直し、再読み込みせずに表示を最新にする（C-77）
const update = useMutation({
  mutationFn: updateRecipe,
  onSuccess: () => queryClient.invalidateQueries({ queryKey: recipeKeys.all }),
});
```

- **MUST**：読み込み中・エラー・データなし・データありの4つを表示で分ける。取得に失敗したとき、データなしとして表示しない
- **MUST NOT**：サーバーのデータを`useState`やZustandにコピーしない
- **MUST**：更新の成功後に、関係するクエリキーを`invalidateQueries`で取り直す

## フォーム（React Hook Form＋Zod）

```ts
const schema = z.object({ title: z.string().min(1, "タイトルを入力してください") });
const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
```

- **MUST**：入力チェックのスキーマはZodで書く。共通のものは`schemas/`、1つの機能だけのものは`features/<機能>/`に置く
- **MUST**：送信中はボタンを押せなくし、多重送信を防ぐ
- **MUST**：サーバーから`VALIDATION_ERROR`の`fields`が返った場合は、該当する入力欄にエラーを表示する

## 画面の中だけの状態

- 1つの部品の中だけの状態は`useState`を使う
- 複数の画面で共有する、画面の中だけの状態が必要になった場合に限り、Zustandを承認を得て追加する
