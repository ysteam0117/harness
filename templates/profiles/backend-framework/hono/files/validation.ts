// 入力チェック（C-27）。Zodの詳しいエラーを利用者に返さず、決めた形式で返す（C-15・C-73）。
// 注意：@hono/zod-validator は既定でZodのエラーをそのまま返すため、必ずこの関数を通して使う。
import { zValidator } from "@hono/zod-validator";
import type { ZodType } from "zod";
import { AppError } from "./app-error";

type Target = "json" | "query" | "param" | "form" | "header" | "cookie";

export function validate<T extends ZodType>(target: Target, schema: T) {
  return zValidator(target, schema, (result) => {
    if (!result.success) {
      throw new AppError("VALIDATION_ERROR", "入力内容を確かめてください", {
        fields: [
          ...new Set(result.error.issues.map((issue) => issue.path.join("."))),
        ],
      });
    }
  });
}
