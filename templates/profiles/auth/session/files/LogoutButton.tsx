// ログアウトのボタン：サーバー側のセッションを無効にしてから、ログインの案内へ移す。
// 外部の IdP のセッションは終了しない（次のログインで、再認証なしで戻る場合がある。C-16）。
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import type { ApiError } from "../../services/api-client";
import { logout } from "./api/auth";
import { ME_QUERY_KEY } from "./useMe";

export function LogoutButton() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const finish = () => {
    void navigate("/login");
    queryClient.removeQueries({ queryKey: ME_QUERY_KEY });
  };
  const mutation = useMutation<void, ApiError>({
    mutationFn: logout,
    onSuccess: finish,
    // 401 は、すでにログアウトしている（期限切れなど）ので、目的の状態になっている
    onError: (error) => {
      if (error.status === 401) finish();
    },
  });

  return (
    <>
      <button
        type="button"
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
      >
        ログアウト
      </button>
      {mutation.isError && mutation.error.status !== 401 && (
        <p role="alert">ログアウトできませんでした。もう一度お試しください</p>
      )}
    </>
  );
}
