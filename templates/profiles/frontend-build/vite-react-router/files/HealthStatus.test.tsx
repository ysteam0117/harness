import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../test/server";
import { HealthStatus } from "./HealthStatus";

function renderWithQuery() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <HealthStatus />
    </QueryClientProvider>,
  );
}

describe("HealthStatus", () => {
  it("サーバーが ok を返したら、状態を表示する", async () => {
    server.use(
      http.get("/api/health", () =>
        HttpResponse.json({ status: "ok", appEnv: "test" }),
      ),
    );
    renderWithQuery();
    expect(await screen.findByText(/サーバーの状態：ok/)).toBeTruthy();
  });

  it("サーバーがエラーを返したら、つながらないことを知らせる", async () => {
    server.use(
      http.get("/api/health", () =>
        HttpResponse.json({ code: "INTERNAL" }, { status: 500 }),
      ),
    );
    renderWithQuery();
    expect((await screen.findByRole("alert")).textContent).toContain(
      "つながりません",
    );
  });
});
