-- 開発用の架空のデータ（C-05）。ユーザー名は testuser_ で始め、後始末（cleanup.sql）で識別して消す。
-- 何回流しても同じ結果になるようにする（すでにあれば何もしない）。
INSERT INTO sample_users (username) VALUES ('testuser_001') ON CONFLICT (username) DO NOTHING;
