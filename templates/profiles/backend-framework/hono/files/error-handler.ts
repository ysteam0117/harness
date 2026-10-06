// グローバル例外ハンドリング（C-73）。処理しきれなかったエラーはすべてここで受け止める。
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { AppError } from "./app-error";
import { createLogger } from "./logger/logger";

export function handleError(err: Error, c: Context) {
  const logger = createLogger({ traceId: c.req.header("X-Request-Id") });
  if (err instanceof AppError) {
    logger.warn("想定したエラー", {
      code: err.code,
      path: c.req.path,
      details: err.details,
    });
    return c.json(
      { code: err.code, message: err.userMessage, ...err.details },
      err.status,
    );
  }
  // Hono が投げる 400（壊れた JSON の本文など）は、入力が正しくないエラーとして、検証のエラーと同じ形で返す。
  // 500 にしない（Schemathesis が見つけた不具合。docs/testing/schemathesis.md）
  if (err instanceof HTTPException && err.status === 400) {
    logger.warn("想定したエラー", {
      code: "VALIDATION_ERROR",
      path: c.req.path,
      reason: "要求の本文を読めません",
    });
    return c.json(
      {
        code: "VALIDATION_ERROR",
        message: "入力内容を確かめてください",
        fields: [],
      },
      422,
    );
  }
  // 想定していないエラー：利用者には一般的なメッセージだけを返し、詳細はログに記録する
  logger.error("想定していないエラー", {
    error: err,
    path: c.req.path,
    method: c.req.method,
  });
  return c.json(
    {
      code: "INTERNAL",
      message:
        "一時的なエラーが発生しました。しばらくしてから、もう一度お試しください",
    },
    500,
  );
}

export function handleNotFound(c: Context) {
  return c.json({ code: "NOT_FOUND", message: "見つかりませんでした" }, 404);
}
