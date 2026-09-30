// API通信の共通部分（C-46）。Axiosのインスタンスはここで1つだけ作り、全体で使う。
import axios, { type AxiosError } from "axios";

export type ApiError = {
  status: number;
  code: string;
  message: string;
  fields?: string[];
};

let onUnauthenticated: ((error: ApiError) => void) | undefined;

// 401を受けたときの処理（認証の更新・ログイン画面への遷移）を、認証方式に合わせて登録する（C-15）
export function setUnauthenticatedHandler(handler: (error: ApiError) => void) {
  onUnauthenticated = handler;
}

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? "/api",
  timeout: 10_000,
  withCredentials: true,
});

// 要求：リクエストIDを付ける（C-30）
apiClient.interceptors.request.use((config) => {
  config.headers.set("X-Request-Id", crypto.randomUUID());
  return config;
});

// 応答：エラーを共通の形に変換する。もみ消さず、必ず失敗として返す（C-71・C-73）
apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError<Partial<ApiError>>) => {
    const status = error.response?.status ?? 0;
    const data = error.response?.data;
    const body = data !== null && typeof data === "object" ? data : {};
    const apiError: ApiError = {
      status,
      code: body.code ?? (status === 0 ? "NETWORK_ERROR" : "UNKNOWN_ERROR"),
      message:
        body.message ??
        (status === 0
          ? "通信できませんでした。接続を確かめてください"
          : "エラーが発生しました"),
      fields: body.fields,
    };
    if (status === 401) onUnauthenticated?.(apiError);
    return Promise.reject(apiError);
  },
);
