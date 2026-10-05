// 画面：ログインが必要なことの案内。ログインの画面は、認証の方式（独自認証・OIDC）を作るときに、この画面を置き換える。
import { Link } from "react-router";

export function LoginRequiredPage() {
  return (
    <main>
      <h1>ログインが必要です</h1>
      <p>この画面を見るには、ログインしてください。</p>
      <Link to="/">ホームへ戻る</Link>
    </main>
  );
}
