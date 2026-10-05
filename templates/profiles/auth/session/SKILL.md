---
name: auth-session
description: ログインの状態（セッション）の持ち方と、認可（認証が要る API の守り方）のルール。認証・認可・ログアウトの処理、保護する API の追加、認証の表を扱うときに読む。
---

<!-- もとになった共通仕様：C-13・C-16・C-17・C-58 -->

# 認証のセッション（共通）

作業の過程と結果は、すべて日本語で書く。

認証の方式（独自認証・OIDC・併用）に関係なく、ログインの状態は**サーバー側のセッション**で持つ。この Skill は、その共通の部分（セッション・認可・ログアウト）のルールを定める。ログインそのもの（パスワード・OIDC）は、方式ごとの Skill（`auth-app`・`auth-oidc`）に従う。

## セッションの仕組み

| 項目 | 内容 | ファイル |
| --- | --- | --- |
| 識別子 | 32 バイトの乱数を base64url にした 43 文字。Cookie に入れるのは、これだけ | `backend/src/lib/session.ts` |
| DB に保存する値 | 識別子そのものではなく、`SESSION_SECRET` を鍵にした HMAC-SHA-256 のハッシュ（16 進数）。DB が漏れても、そのままではセッションとして使えない | 同上・`backend/src/services/session.service.ts` |
| 期限 | 絶対の期限は 7 日（使っていても切れる）、アイドルの期限は 24 時間（最後に使ってから）。期限切れの行は、検証のときに消す | `backend/src/lib/session.ts` |
| Cookie | 本番は `__Host-session`（`Secure`・`HttpOnly`・`SameSite=Lax`・`Path=/`・Domain なし）。開発・検証は `session`（`Secure` なし。http の手元で動かすため）。`APP_ENV` で切り替わる | 同上 |
| 設定 | `SESSION_SECRET`（必須。16 文字以上の生成したランダムな値）。足りなければエラーにし、既定値で隠さない。値は表示しない | `backend/src/lib/auth-config.ts` |

- ログインに成功したときは、`createSessionService(...).create(userId)` でセッションを作り、返った識別子を `serializeSessionCookie` の値で `Set-Cookie` に入れる。識別子は作ったときに1度だけ手に入り、後から DB から取り出せない
- パスワードの変更・再設定・アカウント停止のときは、`destroyAllForUser(userId)` でその利用者のすべてのセッションを消す（C-17 のとおり、ログアウト後・停止後に使えないことを保つ）
- `SESSION_SECRET` を変えると、既存のセッションはすべて使えなくなる（全員がログインし直す）。本番では `wrangler secret put` で入れる（値をチャット・ファイル・コミットに書かない）

## 認可（既定で拒否。C-13）

- `/api/*` は、`backend/src/lib/auth-middleware.ts` の `apiGuard` が入口になり、**許可リストにない API はすべて `requireAuth` を通す**。新しい API を足すだけで保護される。Cookie がない・DB にない・期限切れ・改ざんは、原因を知らせず 401（`UNAUTHENTICATED`）にする
- `backend/src/index.ts` では、`authRoutes(withSessions)` を `routes` の**先頭**に置く。これより後ろに足したルートが保護の対象になる。順番を変えない
- **認証なしで公開する API は、`PUBLIC_API_PATHS`（または、認証の API なら `PUBLIC_AUTH_API_PATHS`）に、理由を付けて足す**。足すときは、なぜ公開してよいかを `reason` に書き、レビューで確かめる
  - いまの許可リストは `/api/health`（死活監視）と `/api/sample-users`（動作確認の見本）。`/api/sample-users` は見本なので、実際の業務の API は `requireAuth` で保護し、見本を消すときにこの行も消す
  - 許可リストは、その名前そのものと、その下のパスだけが対象。似た名前の別の API（`/api/sample-users-private`）は対象にならない
- 保護された API の中では、`currentUser(c)` でログイン中の利用者（`id`・`email`）を読む。利用者の ID は、リクエストの本文・クエリから受け取らず、必ずここから取る（C-14）
- **ログインしただけで、すべてのデータを見せない**。リソースを ID で取得・更新・削除する API は、そのリソースの持ち主が `currentUser(c)` かを、Service で毎回確かめる（C-14）
- 保護された API の応答（200 も 401 も）と、`/api/auth/*` の応答には、`Cache-Control: no-store` が付く（`apiGuard` が付ける。C-58）。許可リストの外の API は、何もしなくても付く
- フロントエンドの `AuthGuard` は、未認証のとき画面をログインの案内へ移す**表示の制御**で、認可の代わりにならない。最終的な認可は、バックエンドの `requireAuth` が行う

### 保護する API の足し方

1. `backend/src/routes/` に、ルートを書く（`routes/sample-users.ts` と同じ形。DB の処理は引数で受け取る）
2. `backend/src/index.ts` の `routes` に、`authRoutes(withSessions)` の**後ろ**に足す。許可リストには足さない（足さなければ、既定で保護される）
3. テストに「未認証は 401」「ログイン中は 200」「他の利用者のリソースは見えない」を入れる（`backend/test/auth-test-app.ts` の `createAuthTestApp`・`issueCookie` が使える）

## API

| API | 内容 |
| --- | --- |
| `GET /api/auth/me` | ログイン中の利用者 `{ id, email }`。未認証は 401。保護する API の見本 |
| `POST /api/auth/logout` | サーバー側のセッション（DB の行）を消し、Cookie を消す。204。送信元の確認（`originCheck`）を通る |

## ログアウトの範囲（C-16）

- ログアウトは、**アプリのセッションだけ**を、クライアント（Cookie を消す）とサーバー（DB の行を消す）の両方で終了する。どの方式でログインしていても同じ
- 外部の IdP（OIDC）のセッションは、ログアウトで終了しない。次にログインするとき、IdP 側にセッションが残っていれば、再認証なしでアプリへ戻ることがある。IdP からもログアウトさせるかは、プロジェクトごとに決めて ADR に残す（同じ IdP を使う他のアプリにも影響するため、アプリのログアウトと一体にしない）
- ログアウト後の画面は、ログインの案内（`/login`）に移す。フロントエンドの `LogoutButton` が行う

## トークン方式（JWT 等）を使わない理由

アクセストークン・リフレッシュトークンの方式ではなく、サーバー側のセッションを使う。

- **すぐに無効にできる**（C-16・C-17）：ログアウト・アカウント停止・パスワード変更のとき、DB の行を消せば、その瞬間から使えない。署名つきトークンは、有効期限が切れるまで使えてしまい、失効には別の仕組み（失効の一覧・短い期限・リフレッシュトークンのローテーション）が要る
- **トークンのライフサイクルを自分で作らなくてよい**（C-17）：トークン方式を採ると、短寿命化・ローテーション・再利用の検知・失効・保存場所を設計し、テストする必要がある。この構成（画面と API が同じドメインの Workers）では、その必要がない
- **同じドメインの構成に合う**：画面と API を同じドメインから配信するため、`HttpOnly` の Cookie で足りる。JavaScript から読めない Cookie は、ブラウザーの保存領域（Web Storage）にトークンを置くより、盗まれにくい
- **IdP のトークンを使い回さない**（C-17）：OIDC でログインしても、外部 IdP の ID トークンは、ログインの確認のためだけに使う。アプリの API への認可には、アプリ自身のセッションを使い、IdP のトークンとは発行者・用途・期限・失効を分ける

## 使わない表は消してよい

認証の表（`users`・`user_identities`・`sessions`・`password_reset_tokens`・`login_attempts`・`oidc_states`）は、認証の方式に関係なく、同じものを作る（マイグレーション `0001_auth.sql`）。

- 使わない表（例：OIDC だけなら `password_reset_tokens`・`login_attempts`）は、`backend/db/auth-schema.ts` から消し、`npm run db:generate -- --name drop_unused_auth_tables` でマイグレーションを足してよい。`0001_auth.sql` は書き換えない（一度適用したものは変えない）
- `users`・`sessions` は、この Skill のコードが使う。消さない

## テストデータと後始末

- テストの利用者は `testuser_`・`e2euser_` で始め、メールは `@example.com` にする。`backend/db/seeds/cleanup.sql` が、この識別子の `users` と、その利用者の `sessions` などを消し、残りの件数が 0 になることを確かめる
- DB に入れる前の識別子（Cookie の値）を、ログ・エラー・テストの失敗の表示に出さない
