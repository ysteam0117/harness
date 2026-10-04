// 部品：サーバーの状態を表示する。サーバーの状態は TanStack Query で扱う。
import { useQuery } from "@tanstack/react-query";
import { fetchHealth } from "./api/health";

export function HealthStatus() {
  const { data, error, isPending } = useQuery({
    queryKey: ["health"],
    queryFn: fetchHealth,
  });

  if (isPending) return <p>確認中です</p>;
  if (error) return <p role="alert">サーバーにつながりません</p>;
  return (
    <p>
      サーバーの状態：{data.status}（環境：{data.appEnv}）
    </p>
  );
}
