// 画面：ログインが必要な画面の見本。部品を組み合わせるだけにする（C-06）。
import { AccountInfo } from "../features/auth/AccountInfo";
import { AuthGuard } from "../features/auth/AuthGuard";

export function AccountPage() {
  return (
    <main>
      <h1>アカウント</h1>
      <AuthGuard>
        <AccountInfo />
      </AuthGuard>
    </main>
  );
}
