// プロトタイプの見本：架空のデータで、読み込み中・データあり・データなし・エラーを切り替える。
// 本物の API は呼ばない。変化はブラウザの中だけで保持する。
"use strict";

const sampleUsers = [
  { name: "testuser_001", email: "testuser_001@example.com" },
  { name: "testuser_002", email: "testuser_002@example.com" },
];

const state = { view: "loading", users: sampleUsers.slice() };

function render() {
  const screen = document.getElementById("screen");
  screen.replaceChildren();
  if (state.view === "loading") {
    screen.textContent = "読み込み中…";
    return;
  }
  if (state.view === "error") {
    const p = document.createElement("p");
    p.className = "error";
    p.textContent = "読み込みに失敗しました。時間をおいて、もう一度お試しください。";
    screen.append(p);
    return;
  }
  const users = state.view === "empty" ? [] : state.users;
  if (users.length === 0) {
    screen.textContent = "まだ登録がありません。";
    return;
  }
  const list = document.createElement("ul");
  for (const user of users) {
    const item = document.createElement("li");
    item.textContent = `${user.name}（${user.email}）`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "削除";
    remove.addEventListener("click", () => {
      state.users = state.users.filter((u) => u !== user);
      render();
    });
    item.append(" ", remove);
    list.append(item);
  }
  screen.append(list);
}

for (const button of document.querySelectorAll("nav button")) {
  button.addEventListener("click", () => {
    state.view = button.dataset.state;
    render();
  });
}

render();
setTimeout(() => {
  state.view = "data";
  render();
}, 500);
