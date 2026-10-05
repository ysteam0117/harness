// ログイン中の利用者を取る。401（未認証）は想定した結果なので、やり直さない。
import { useQuery } from "@tanstack/react-query";
import type { ApiError } from "../../services/api-client";
import { fetchMe, type Me } from "./api/auth";

export const ME_QUERY_KEY = ["auth", "me"] as const;

export function useMe() {
  return useQuery<Me, ApiError>({
    queryKey: ME_QUERY_KEY,
    queryFn: fetchMe,
    retry: false,
  });
}
