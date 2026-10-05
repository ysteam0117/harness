// 画面の入口の確認：ログインしていなければ、ログインの案内（/login）へ移す。
// これは表示の制御で、認可の代わりにならない。最終的な認可は、バックエンドの requireAuth が行う（C-13）。
import type { ReactNode } from "react";
import { Navigate } from "react-router";
import { useMe } from "./useMe";

export function AuthGuard({ children }: { children: ReactNode }) {
  const { error, isPending } = useMe();

  if (isPending) return <p>確認中です</p>;
  if (error?.status === 401) return <Navigate to="/login" replace />;
  if (error) return <p role="alert">サーバーにつながりません</p>;
  return <>{children}</>;
}
