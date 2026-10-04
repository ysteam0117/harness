// 画面の入口。ルーティング（React Router）とサーバーの状態（TanStack Query）をここで用意する。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App";

const queryClient = new QueryClient();
const root = document.getElementById("root");
if (root === null)
  throw new Error("画面の入口（#root）が index.html にありません");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
