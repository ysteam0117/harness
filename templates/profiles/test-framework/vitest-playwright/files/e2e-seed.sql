-- E2E 用の架空のデータ（C-05・C-37）。ユーザー名は e2euser_ で始め、後始末（cleanup.sql）で識別して消す。
-- 何回流しても同じ結果になるようにする（すでにあれば何もしない）。
INSERT INTO sample_users (username) VALUES ('e2euser_health_001') ON CONFLICT (username) DO NOTHING;
