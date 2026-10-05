// API 層：認証の状態の取得とログアウト。共通の apiClient（services/）を使う（C-46）。
import { apiClient } from "../../../services/api-client";

export type Me = {
  id: string;
  email: string;
};

export async function fetchMe(): Promise<Me> {
  const response = await apiClient.get<Me>("/auth/me");
  return response.data;
}

export async function logout(): Promise<void> {
  await apiClient.post("/auth/logout");
}
