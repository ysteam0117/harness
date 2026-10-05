// 画面の振り分け（ルーティング）。画面は pages/ に置く。ログインが必要な画面は、AuthGuard を通す。
import { Route, Routes } from "react-router";
import { AccountPage } from "./pages/AccountPage";
import { HomePage } from "./pages/HomePage";
import { LoginRequiredPage } from "./pages/LoginRequiredPage";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/login" element={<LoginRequiredPage />} />
      <Route path="/account" element={<AccountPage />} />
    </Routes>
  );
}
