-- 後始末：テストデータだけを、識別子（testuser_ または e2euser_ で始まるユーザー名・メール。LIKE の _ は文字どおりに扱うため ESCAPE を使う）で消す（C-05）。
-- testuser_ は開発・単体のテストのデータ、e2euser_ は E2E のデータ。
-- 認証の表は、利用者（users）の行を消す前に、その利用者に属する行（sessions など）を先に消す。
-- ログイン試行（login_attempts）・OIDC の途中の状態（oidc_states）は、キーが利用者に結びつかないため、それぞれを使う Issue（独自認証・OIDC）で足す。
-- 実行したあと、残りの件数が 0 になることを確かめる（下の SELECT の結果が 0）。
DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'testuser!_%' ESCAPE '!' OR email LIKE 'e2euser!_%' ESCAPE '!');
DELETE FROM password_reset_tokens WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'testuser!_%' ESCAPE '!' OR email LIKE 'e2euser!_%' ESCAPE '!');
DELETE FROM user_identities WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'testuser!_%' ESCAPE '!' OR email LIKE 'e2euser!_%' ESCAPE '!');
DELETE FROM users WHERE email LIKE 'testuser!_%' ESCAPE '!' OR email LIKE 'e2euser!_%' ESCAPE '!';
DELETE FROM sample_users WHERE username LIKE 'testuser!_%' ESCAPE '!' OR username LIKE 'e2euser!_%' ESCAPE '!';

SELECT COUNT(*) AS remaining FROM sample_users WHERE username LIKE 'testuser!_%' ESCAPE '!' OR username LIKE 'e2euser!_%' ESCAPE '!';
SELECT COUNT(*) AS remaining_users FROM users WHERE email LIKE 'testuser!_%' ESCAPE '!' OR email LIKE 'e2euser!_%' ESCAPE '!';
