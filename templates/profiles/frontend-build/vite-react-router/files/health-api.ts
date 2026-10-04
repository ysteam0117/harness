// API 層：サーバーとの通信はここに書く。共通の apiClient（services/）を使う（C-46）。
import { apiClient } from "../../../services/api-client";

export type Health = {
  status: "ok";
  appEnv: string;
};

export async function fetchHealth(): Promise<Health> {
  const response = await apiClient.get<Health>("/health");
  return response.data;
}
