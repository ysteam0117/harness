// 部品：ログイン中の利用者のメールと、ログアウトのボタン。
import { LogoutButton } from "./LogoutButton";
import { useMe } from "./useMe";

export function AccountInfo() {
  const { data } = useMe();
  return (
    <section>
      <p>ログイン中：{data?.email}</p>
      <LogoutButton />
    </section>
  );
}
