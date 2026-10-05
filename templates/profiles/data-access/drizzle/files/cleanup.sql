-- 後始末：テストデータだけを、識別子（testuser_ または e2euser_ で始まるユーザー名。LIKE の _ は文字どおりに扱うため ESCAPE を使う）で消す（C-05）。
-- testuser_ は開発・単体のテストのデータ、e2euser_ は E2E のデータ。
-- 実行したあと、残りの件数が 0 になることを確かめる（下の SELECT の結果が 0）。
DELETE FROM sample_users WHERE username LIKE 'testuser!_%' ESCAPE '!' OR username LIKE 'e2euser!_%' ESCAPE '!';

SELECT COUNT(*) AS remaining FROM sample_users WHERE username LIKE 'testuser!_%' ESCAPE '!' OR username LIKE 'e2euser!_%' ESCAPE '!';
