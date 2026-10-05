// Skill「frontend-state」の例：フォーム（React Hook Form＋Zod）のサーバーのエラーの表示と、多重送信の防止。
// Skill の書き方の例なので、消さない。ハーネスが管理するファイルで、ハーネスの更新で置き換わる。
import { zodResolver } from "@hookform/resolvers/zod";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { apiClient, type ApiError } from "../services/api-client";
import { server } from "../test/server";

const schema = z.object({
  title: z.string().min(1, "タイトルを入力してください"),
});
type Values = z.infer<typeof schema>;
const postRecipe = (values: Values) => apiClient.post("/recipes", values);

// #region example:form-field-errors
export function RecipeForm() {
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema) });

  const onSubmit = async (values: Values) => {
    try {
      await postRecipe(values);
    } catch (e) {
      const error = e as ApiError;
      // サーバーが VALIDATION_ERROR で返した fields を、該当する入力欄のエラーにする
      if (error.code === "VALIDATION_ERROR") {
        const fields = error.fields?.filter((field) => field === "title") ?? [];
        const message = error.message || "入力内容を確かめてください";
        if (fields.length > 0) {
          fields.forEach((field) => setError(field, { message }));
        } else {
          setError("root.server", { message });
        }
      } else {
        setError("root.server", {
          message: "送信に失敗しました。時間をおいて、もう一度お試しください",
        });
      }
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <label>
        タイトル
        <input {...register("title")} aria-invalid={!!errors.title} />
      </label>
      {errors.title && <p role="alert">{errors.title.message}</p>}
      {errors.root?.server && <p role="alert">{errors.root.server.message}</p>}
      {/* 送信中は押せなくして、多重送信を防ぐ */}
      <button type="submit" disabled={isSubmitting}>
        登録
      </button>
    </form>
  );
}
// #endregion

// #region example:form-error-toast-bad
export function RecipeFormToastBad() {
  const [failed, setFailed] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema) });

  const onSubmit = async (values: Values) => {
    try {
      await postRecipe(values);
    } catch {
      // 悪い例：全体のメッセージだけ。どの入力欄が誤りか、利用者に伝わらない
      setFailed(true);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <label>
        タイトル
        <input {...register("title")} aria-invalid={!!errors.title} />
      </label>
      {failed && <p role="status">登録に失敗しました</p>}
      <button type="submit" disabled={isSubmitting}>
        登録
      </button>
    </form>
  );
}
// #endregion

// #region example:form-double-submit-bad
export function RecipeFormDoubleSubmitBad() {
  const { register, handleSubmit } = useForm<Values>({
    resolver: zodResolver(schema),
  });

  return (
    <form onSubmit={handleSubmit((values) => postRecipe(values))}>
      <label>
        タイトル
        <input {...register("title")} />
      </label>
      {/* 悪い例：送信中も押せる。続けて押すと、同じ内容が2回送られる */}
      <button type="submit">登録</button>
    </form>
  );
}
// #endregion

const invalid = () =>
  HttpResponse.json(
    {
      code: "VALIDATION_ERROR",
      message: "このタイトルは使えません",
      fields: ["title"],
    },
    { status: 422 },
  );

async function submit(ui: React.ReactElement, count = 1) {
  render(ui);
  await userEvent.type(screen.getByLabelText("タイトル"), "testrecipe_001");
  const button = screen.getByRole("button", { name: "登録" });
  for (let i = 0; i < count; i++) await userEvent.click(button);
}

describe("サーバーの入力エラーを、入力欄に表示する", () => {
  it("良い例：誤りのある入力欄が示され、理由が表示される", async () => {
    server.use(http.post("/api/recipes", invalid));
    await submit(<RecipeForm />);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "このタイトルは使えません",
    );
    expect(screen.getByLabelText("タイトル").getAttribute("aria-invalid")).toBe(
      "true",
    );
  });

  it.each([undefined, [], ["unknown"]])(
    "良い例：表示できる fields がない（%j）入力エラーは全体に表示する",
    async (fields) => {
      server.use(
        http.post("/api/recipes", () =>
          HttpResponse.json(
            {
              code: "VALIDATION_ERROR",
              message: "入力内容に誤りがあります",
              ...(fields === undefined ? {} : { fields }),
            },
            { status: 422 },
          ),
        ),
      );
      await submit(<RecipeForm />);
      expect((await screen.findByRole("alert")).textContent).toBe(
        "入力内容に誤りがあります",
      );
      expect(
        screen.getByLabelText("タイトル").getAttribute("aria-invalid"),
      ).toBe("false");
    },
  );

  it("良い例：HTTP 500 では全体のエラーを表示し、再送信できる", async () => {
    server.use(
      http.post("/api/recipes", () => new HttpResponse(null, { status: 500 })),
    );
    await submit(<RecipeForm />);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "送信に失敗しました。時間をおいて、もう一度お試しください",
    );
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "登録" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
  });

  it("悪い例の問題：全体のメッセージだけでは、どの入力欄が誤りか分からない", async () => {
    server.use(http.post("/api/recipes", invalid));
    await submit(<RecipeFormToastBad />);
    expect(await screen.findByText("登録に失敗しました")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByLabelText("タイトル").getAttribute("aria-invalid")).toBe(
      "false",
    );
  });
});

describe("送信中は、送信のボタンを押せなくする", () => {
  // 応答を止めておき（release で返す）、送信の途中で、ボタンを続けて押す
  const holdPosts = () => {
    const posts = { count: 0, release: () => {} };
    const gate = new Promise<void>((resolve) => (posts.release = resolve));
    server.use(
      http.post("/api/recipes", async () => {
        posts.count += 1;
        await gate;
        return HttpResponse.json({ ok: true }, { status: 201 });
      }),
    );
    return posts;
  };

  it("良い例：続けて押しても、送られるのは1回", async () => {
    const posts = holdPosts();
    await submit(<RecipeForm />, 2);
    await waitFor(() => expect(posts.count).toBe(1));
    await delay(100);
    expect(posts.count).toBe(1);
    posts.release();
    await delay(50); // 応答が届いてから、テストを終える
  });

  it("悪い例の問題：続けて押すと、同じ内容が2回送られる", async () => {
    const posts = holdPosts();
    await submit(<RecipeFormDoubleSubmitBad />, 2);
    await waitFor(() => expect(posts.count).toBe(2));
    posts.release();
    await delay(50); // 応答が届いてから、テストを終える
  });
});
