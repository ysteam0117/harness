// 画面：部品を組み合わせるだけにする（C-06）。API は features/ の中の api 層が呼ぶ。
import { HealthStatus } from "../features/health/HealthStatus";

export function HomePage() {
  return (
    <main>
      <h1>ようこそ</h1>
      <HealthStatus />
    </main>
  );
}
