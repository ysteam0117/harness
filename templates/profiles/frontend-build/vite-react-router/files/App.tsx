// 画面の振り分け（ルーティング）。画面は pages/ に置く。
import { Route, Routes } from "react-router";
import { HomePage } from "./pages/HomePage";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
    </Routes>
  );
}
