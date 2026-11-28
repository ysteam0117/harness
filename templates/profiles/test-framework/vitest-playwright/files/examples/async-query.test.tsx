// ハーネスが管理する例のテスト。Skill「テストの道具」で使うため消さない。
import { render, screen, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
import { expect, it } from "vitest";

function pendingResponse() {
  let resolve!: (href: string) => void;
  const promise = new Promise<string>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function DetailsLink({
  response,
  initialHref,
}: {
  response: Promise<string>;
  initialHref?: string;
}) {
  const [href, setHref] = useState(initialHref);
  useEffect(() => {
    void response.then(setHref);
  }, [response]);
  return <a href={href}>詳細</a>;
}

it("応答を待ち、href が付いてリンクになった要素を探す", async () => {
  const response = pendingResponse();
  render(<DetailsLink response={response.promise} />);
  expect(screen.queryByRole("link", { name: "詳細" })).toBeNull();
  response.resolve("/items/1");

  // #region example:async-link-query
  const link = await screen.findByRole("link", { name: "詳細" });
  expect(link.getAttribute("href")).toBe("/items/1");
  // #endregion
});

it("初めから見つかるリンクの行き先が変わるまで待つ", async () => {
  const response = pendingResponse();
  render(<DetailsLink response={response.promise} initialHref="/items/0" />);
  expect(screen.getByRole("link", { name: "詳細" }).getAttribute("href")).toBe(
    "/items/0",
  );
  response.resolve("/items/1");

  // #region example:async-link-attribute
  await waitFor(() =>
    expect(
      screen.getByRole("link", { name: "詳細" }).getAttribute("href"),
    ).toBe("/items/1"),
  );
  // #endregion
});
