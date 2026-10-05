import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { server } from "../../test/server";
import { LogoutButton } from "./LogoutButton";

function renderButton() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/account"]}>
        <Routes>
          <Route
            path="/login"
            element={<p>ログインが必要です（案内の画面）</p>}
          />
          <Route path="/account" element={<LogoutButton />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("LogoutButton", () => {
  it("押すとログアウトの API（POST /api/auth/logout）を呼び、ログインの案内へ移す", async () => {
    let called = 0;
    server.use(
      http.post("/api/auth/logout", () => {
        called += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderButton();
    await userEvent.click(screen.getByRole("button", { name: "ログアウト" }));
    expect(await screen.findByText(/ログインが必要です/)).toBeTruthy();
    expect(called).toBe(1);
  });

  it("失敗したときは、画面を移さず、失敗を知らせる", async () => {
    server.use(
      http.post("/api/auth/logout", () =>
        HttpResponse.json({ code: "INTERNAL" }, { status: 500 }),
      ),
    );
    renderButton();
    await userEvent.click(screen.getByRole("button", { name: "ログアウト" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "ログアウトできませんでした",
    );
    expect(screen.queryByText(/ログインが必要です/)).toBeNull();
  });
});
