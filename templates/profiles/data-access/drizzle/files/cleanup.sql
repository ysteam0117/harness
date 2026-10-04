-- 後始末：テストデータだけを、識別子（testuser_ で始まるユーザー名。LIKE の _ は文字どおりに扱うため ESCAPE を使う）で消す（C-05）。
-- 実行したあと、残りの件数が 0 になることを確かめる（下の SELECT の結果が 0）。
DELETE FROM sample_users WHERE username LIKE 'testuser!_%' ESCAPE '!';

SELECT COUNT(*) AS remaining FROM sample_users WHERE username LIKE 'testuser!_%' ESCAPE '!';
