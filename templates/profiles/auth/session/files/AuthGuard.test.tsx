import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { server } from "../../test/server";
import { AuthGuard } from "./AuthGuard";

function renderGuard() {
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
          <Route
            path="/account"
            element={
              <AuthGuard>
                <p>保護された画面</p>
              </AuthGuard>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AuthGuard", () => {
  it("未認証（401）なら、保護された画面を見せず、ログインの案内（/login）へ移す", async () => {
    server.use(
      http.get("/api/auth/me", () =>
        HttpResponse.json({ code: "UNAUTHENTICATED" }, { status: 401 }),
      ),
    );
    renderGuard();
    expect(await screen.findByText(/ログインが必要です/)).toBeTruthy();
    expect(screen.queryByText("保護された画面")).toBeNull();
  });

  it("ログイン中なら、保護された画面を見せる", async () => {
    server.use(
      http.get("/api/auth/me", () =>
        HttpResponse.json({
          id: "testuser_001",
          email: "e2euser_session_001@example.com",
        }),
      ),
    );
    renderGuard();
    expect(await screen.findByText("保護された画面")).toBeTruthy();
  });

  it("確認中は、保護された画面を見せない", () => {
    server.use(http.get("/api/auth/me", () => new Promise(() => undefined)));
    renderGuard();
    expect(screen.getByText("確認中です")).toBeTruthy();
    expect(screen.queryByText("保護された画面")).toBeNull();
  });

  it("サーバーのエラー（401 以外）のときは、案内ではなく、つながらないことを知らせる", async () => {
    server.use(
      http.get("/api/auth/me", () =>
        HttpResponse.json({ code: "INTERNAL" }, { status: 500 }),
      ),
    );
    renderGuard();
    expect((await screen.findByRole("alert")).textContent).toContain(
      "つながりません",
    );
    expect(screen.queryByText("保護された画面")).toBeNull();
  });
});
