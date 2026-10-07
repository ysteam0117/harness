# 設計書：動くアプリの土台（Issue #56）

## 目的と範囲

`harness create` で生成したプロジェクトが、`npm install` の後に、そのまま動く状態にする。API の入口（Hono）、画面の入口（React）、DB のスキーマ・マイグレーション・シードの最初のファイル、`package.json` の scripts、TypeScript の設定、`README.md`、`.gitignore`、`.env.example`、`docker-compose.yml`、`wrangler.jsonc` を生成する。

利用者が答えた内容（DB・認証・アップロード）で、生成するファイルを変える仕組み（`files_when`・`wrangler`・`wrangler_when`・`package_json_when`）も、このIssueで入れた。

| 番号 | 受け入れ条件 |
| --- | --- |
| AC-1 | `npm install` の後に、開発サーバーが起動する |
| AC-2 | `npm run check` が通る |
| AC-3 | DB・認証・アップロードの回答に応じて、生成するファイルが変わる |

AC-3 は「設定のファイルの違い」までを対象にする。認証・アップロードの処理そのものは扱わない。

### ほかの Issue との分担

| Issue | 扱うもの | #56 との境目 |
| --- | --- | --- |
| #51 | 環境変数の切り替えと、テストがほかの環境を使わない仕組み | #56 は `.env.example` と `APP_ENV` の項目までを入れる。切り替えの仕組みは #51 |
| #57 | 生成の直後の `npm install` と品質チェック | #56 は、`npm run smoke:generated` で生成物の動作を確かめる（ハーネス側の確認）。`harness create` が生成の直後に実行する処理は #57 |
| #63 | 文書と GitHub のファイル（要件定義書・ADR・テストの手順書・PR／Issue のテンプレート・CI・LICENSE など） | CI の実行場所・公開・GitHub による違いは #63 |
| #64 | E2E と IaC | 本番の Hyperdrive の id などの本物の値は IaC で決める。#56 の値は手元の開発用の仮の値 |
| #65（#72〜#75） | 認証の処理とテスト | #56 は認証の回答に応じた環境変数の項目（`SESSION_SECRET`・`OIDC_*`）まで。#72 は生成の仕組み（`all`・認証のプロファイルの枠・整合性ルール・環境変数・未決定事項）まで。#73 は共通のセッションと認可。ログイン（独自認証・OIDC）の処理は #74・#75 |
| #66 | アップロードの処理とテスト | #56 は R2 のバインディングを `wrangler.jsonc` に足すところまで |

## 生成されるプロジェクトの構成

### API（`backend/src/`）

C-03 の層構成「Controller → Service → Repository」に合わせる。

| 場所 | 役割 | 出すもの |
| --- | --- | --- |
| `app.ts` | Hono のアプリ（`createApp`）。セキュリティヘッダー・送信元の確認・エラーハンドラ・ルートを組み立てる。追加のルートは `options.routes` で受け取る | `templates/project/backend/app.ts` |
| `config.ts` | 環境変数の読み込み（`loadConfig`） | `templates/project/backend/config.ts` |
| `index.ts` | Workers の入口。DB なしは `createApp()` だけ。DB ありは、サンプルの利用者のルートを渡して組み込む | DB なしは `templates/project/backend/index.none.ts`、DB ありは `data-access/drizzle` の `files/index.ts` |
| `routes/` | Controller。要求を受け、Service を呼び、応答の形にする | `health.ts`（`healthRoutes`）。DB ありは `sample-users.ts`（`sampleUserRoutes`） |
| `services/` | Service。HTTP も DB のライブラリも知らない | `health.service.ts`（`getHealth`）。DB ありは `sample-users.service.ts`（`listSampleUsers`・`addSampleUser`） |
| `db/` | Repository と DB への接続。`pg` を読み込むのはここだけ | `database.ts`・`sample-user.repository.ts` |
| `lib/` | 共通の部分（`app-error`・`error-handler`・`security`・`validation`、ロガー） | `backend-framework/hono`・`logger/structured-logger` のプロファイル |

`db/` の外には、スキーマ（`backend/db/schema.ts`）、マイグレーション（`backend/db/migrations/`）、シードと後始末（`backend/db/seeds/seed.sql`・`cleanup.sql`）を置く。

### 画面（`frontend/src/`）

| 場所 | 役割 |
| --- | --- |
| `main.tsx`・`App.tsx` | 画面の入口とルーティング |
| `pages/` | ページ。部品を組み合わせるだけ（`HomePage.tsx`） |
| `features/<機能>/` | 機能ごとの部品。API を呼ぶ層は `features/<機能>/api/` に置く（`features/health/api/health.ts`・`HealthStatus.tsx`） |
| `services/` | 通信の共通部分（`http-client/axios` の `api-client.ts`） |

層の依存の向きは、`.dependency-cruiser.cjs`（`quality/typescript-standard` の `files/dependency-cruiser.cjs`）で、違反が1件でもあれば失敗にする。

- フロントエンド：`pages` から `features/*/api` と `services` を直接参照しない。`components` から `services` を直接参照しない。`features` から `pages` を参照しない
- バックエンド：`routes` から `db` を直接参照しない（`services` を通す）。`db` から `services`・`routes` を参照しない。`services` から `routes` を参照しない。`services` から Hono を参照しない
- 循環した参照は禁止

### ルートのファイル

`package.json`・`.node-version`・`tsconfig.json`・`vite.config.ts`・`vitest.config.ts`・`index.html`・`.gitignore`・`.prettierignore`・`.env.example`・`README.md`・`docker-compose.yml`・`wrangler.jsonc`・`drizzle.config.ts`（DB ありのみ）。`.gitignore` は、ひな形のフォルダの設定に影響しないよう、ひな形では `gitignore`（先頭のドットなし）の名前で置き、出力時に `.gitignore` にする。

これらは、プロジェクトのものである。ハーネスが管理するファイル（F-27）ではない（`managed_files` に入れない）。

## 回答による違い

### 仕組み

`profile.yaml` に、回答に合うときだけ働く4つの項目を足した。条件は `{ answer: <質問の id>, equals: <回答> }` の形（#72 から、`{ all: [...] }` で組み合わせも書ける）で、`src/generate/conditions.ts` の `parseWhen`・`whenMatches` で読み、判定する（`packages_when` と同じ書き方）。

| 項目 | 内容 | 組み立てる関数 |
| --- | --- | --- |
| `files_when` | 条件に合うときだけ出すファイル（`files` と同じ「元: 出力先」の形） | `selectProfileFiles`（`src/generate/profile.ts`）。無条件の `files` の後ろに、合うものを書いた順に並べる |
| `wrangler` | `wrangler.jsonc` に足す設定（無条件） | `mergeWrangler`（`profile.ts`） |
| `wrangler_when` | 条件に合うときだけ足す `wrangler.jsonc` の設定 | `mergeWrangler`（同上） |
| `package_json_when` | 条件に合うときだけ足す `package.json` の項目 | `mergePackageJson`（`profile.ts`。`answers` を受け取るようになった） |

- 読み込み（`loadProfile`）の検証：`when` と中身の項目が両方ある、知らない項目がない、`files_when` の元のファイルが存在する、出力先が重ならない（`readFileMap`・`whenItems`）
- 複数のプロファイルや条件が同じ項目に値を足したときは、深くまとめる。同じ項目に違う値があればエラー（`package_json` と同じ。エラーの文には `wrangler`・`package_json` のどちらかを示す）
- `buildOutputs`（`src/generate/plan.ts`）は、`answers` を受け取り、`selectProfileFiles` と `mergePackageJson` に渡す。`answers` を省くと、条件つきの項目は何も合わない
- 出力先が重なるときは、これまでどおり `checkOutputPaths` でエラーにする

ひな形の中には条件の分岐を書かない（F-28）。DB の種類で内容が違うファイルは、`schema.d1.ts`・`schema.pg.ts` のように別のファイルにして、`files_when` で選ぶ。

### DB・アップロード・認証の違い

| 回答 | 出るファイル・設定 |
| --- | --- |
| D1 | `database.ts`・`schema.ts`・`drizzle.config.ts`・マイグレーションの D1 版、`vitest.config.ts` は D1 版（マイグレーションを読み込んでテスト用の D1 に適用する。`backend/test/apply-migrations.ts` も出る）、サンプルの利用者の Repository と route の結合テスト、`wrangler.jsonc` に `d1_databases`（`migrations_dir` を含む）、`db:*` の scripts（`wrangler d1`）、`docker-compose.yml` は backend のみ |
| PostgreSQL | 上記の PostgreSQL 版（`pg` を使う）、`vitest.config.ts` は PostgreSQL 版、`wrangler.jsonc` に `hyperdrive`（バインディング名 `HYPERDRIVE`）と `compatibility_flags: [nodejs_compat]`、`db:*` の scripts（`drizzle-kit`・`docker compose exec ... psql`）、`docker-compose.yml` は `db` と backend、`.env.example` に `POSTGRES_*`・`DATABASE_URL`・Hyperdrive の手元の接続先 |
| DB なし | `index.ts` は `createApp()` だけ（`index.none.ts`）。サンプルの利用者のファイル・スキーマ・マイグレーション・`drizzle.config.ts`・`db:*` の scripts は出ない。`vitest.config.ts` は DB なし版。`/api/sample-users` は 404 |
| アップロードあり | `wrangler.jsonc` に `r2_buckets`（バインディング名 `UPLOADS`、バケット名 `<アプリ名>-uploads`）。処理とテストは #66 |
| 認証あり（oidc・app・both） | `.env.example` に `SESSION_SECRET`。oidc・both は `OIDC_CLIENT_ID`・`OIDC_CLIENT_SECRET`・`OIDC_ISSUER`・`OIDC_REDIRECT_URI`・`APP_BASE_URL` も（`data/env-items.yaml` の `when`。#72）。認証のプロファイル（`auth/session`・`auth/app-auth`・`auth/oidc-auth`）が選ばれ、Skill が出る。`auth/session`（#73）は、共通のセッション・認可・認証の表・マイグレーション・画面のガード・テストを出す（下の「認証：共通のセッションと認可（#73）」）。独自認証・OIDC のログインの処理は #74・#75 |

無効な組み合わせ（DB なしの認証あり（app・oidc・both。#72 で oidc を追加）・DB なしのアップロード）は、整合性チェックがエラーにする。有効な組み合わせは 17 通りである（`test/generate/skeleton.test.ts`）。

どの `profile.yaml` が何を持つか。

| プロファイル | 持つもの |
| --- | --- |
| `data-access/drizzle` | `files_when`（D1・PostgreSQL）、`wrangler_when`（D1・Hyperdrive）、`package_json_when`（`db:*`） |
| `backend-framework/hono` | `wrangler_when`（アップロードのとき R2）、`files`（lib） |
| `frontend-build/vite-react-router` | `wrangler`（`name`・`main`・`compatibility_date`・`assets`・`vars`）、`files`（画面・`_headers`）、`package_json`（`dev`・`build`・`preview`・`types`・`predev`） |
| `quality/typescript-standard` | `package_json`（`check` ほかの品質チェック）、`files`（`tsconfig.json`・`.dependency-cruiser.cjs` ほか） |
| `test-framework/vitest-playwright` | `files_when`（`vitest.config.ts` の DB 別）、`package_json`（`test`・`pretest`） |

## 認証のための生成の仕組み（#72）

認証の処理とテストは #73〜#75 で作る。#72 は、そのための生成の仕組みだけを入れた。#73 が、この仕組みを使って共通の部分を作った。

- `files_when` などの条件に、`all`（条件の組み合わせ）を書ける（[generation.md](generation.md)）。認証ありのとき、drizzle の `migrations/meta`・`backend/src/index.ts`・`frontend/src/App.tsx` を認証のプロファイル側の版で出したい。後続の Issue は、元のプロファイル（`data-access/drizzle`・`frontend-build/vite-react-router`）の該当ファイルを `files` から `files_when` へ移し、`when: { answer: auth, equals: none }`（DB の種類と組み合わせるときは `all`）で「認証なしのときだけ」出すようにして、認証側の版を同じ出力先で `when: { answer: auth, notEquals: none }` に置く。`files` から `files_when` へ移しても、認証なしの出力が変わらないことは `conditional-profile.test.ts` で確かめた。**#73 で差し替えた**（`index.ts`・`cleanup.sql`・`drizzle.config.ts`・`meta/_journal.json`・`App.tsx` は、認証なしのときだけ元のファイルを出し、認証ありは `auth/session` の版を出す）
- 出力先の重なりは、今までどおり `buildOutputs` がエラーにする。排他の条件（認証なし／あり）なら、同じ出力先でも重ならない
- `templates/profiles/auth/` に、`session`・`app-auth`・`oidc-auth` の枠（`profile.yaml`・`SKILL.md`。`packages` は空、`files` はなし）を置いた。`data/profile-selection.yaml` が、`auth` が `none` 以外のとき `auth/session`、`app`・`both` のとき `auth/app-auth`、`oidc`・`both` のとき `auth/oidc-auth` を選ぶ。認証の依存パッケージは、後続の Issue が各プロファイルの `packages` に置く
- 整合性チェック `auth-needs-db` は、`auth` が `app`・`oidc`・`both` で DB が `none` のときエラーにする（セッションを DB に保存するため。C-16）。`id` は変えない
- 要件定義書の「未決定事項」に、独自認証（`app`・`both`）のときだけ4行を差し込む（`auth_undecided_rows`。[generation.md](generation.md)）
- 認証が `none` の生成結果は、変更の前と同じ（`test/generate/auth-generation.test.ts` が、DB なし・D1・PostgreSQL の3通りのファイルの一覧と指紋を、`test/generate/fixtures/auth-none-baseline.json`（変更の前の記録）と比べる）
- smoke（`scripts/smoke-generated.ts` の `writeEnvFile`）は、空の `OIDC_ISSUER`・`OIDC_REDIRECT_URI`・`APP_BASE_URL` に架空の値（`https://idp.example.test` など）を、開発・検証の両方の `.env` に入れる

## 認証：共通のセッションと認可（#73）

認証の方式（`app`・`oidc`・`both`）に関係なく、ログインの状態を **サーバー側のセッション**で持つ共通の部分を、`auth/session` が出す。ログインそのもの（パスワード・OIDC）は #74・#75。新しい npm の依存は足さない（ハッシュは WebCrypto の HMAC-SHA-256）。認証が `none` のときは何も出さない（AC-2。`auth-none-baseline.json` と一致）。

### 受け入れ条件

| 番号 | 受け入れ条件 | 確かめ方 |
| --- | --- | --- |
| AC-1 | 未認証の保護 API が 401、期限切れ・改ざん・ログアウト後の Cookie が 401、DB に生の識別子がない | 生成したプロジェクトのテスト（下の表）。実 DB（D1・PostgreSQL）は `npm run smoke:generated` |
| AC-2 | 認証が none の場合は何も生成しない | `test/generate/auth-session.test.ts`・`auth-generation.test.ts`（基準との一致） |

### 出すもの

| 区分 | ファイル（生成先） | 内容 |
| --- | --- | --- |
| DB | `backend/db/auth-schema.ts`（D1・PostgreSQL で別の版） | 6つの表：`users`・`user_identities`・`sessions`・`password_reset_tokens`・`login_attempts`・`oidc_states`。外部キーは `users` に向け、削除で連鎖する。日時は Date で読み書きする（D1 はミリ秒の整数、PostgreSQL は timestamptz）。`user_identities` は (`issuer`, `subject`) を主キーにして一意にする |
| DB | `drizzle.config.ts`（認証ありの版） | スキーマに `schema.ts` と `auth-schema.ts` の両方を指す |
| DB | `backend/db/migrations/0001_auth.sql`・`meta/_journal.json`（0000 と 0001）・`meta/0001_snapshot.json` | **手で書かず**、生成したプロジェクトで `drizzle-kit generate --name auth` を実際に実行して作ったものを `auth/session` に置く（D1・PostgreSQL の2組）。`0000_init.sql`・`0000_snapshot.json` は共通のまま |
| DB | `backend/db/seeds/cleanup.sql`（認証ありの版） | `users` の `testuser_`・`e2euser_` の行と、その利用者の `sessions` などを消し、残りの件数が 0 になることを確かめる。`seed.sql` は変えない（認証の表のテストデータは、テストの中で作る） |
| バックエンド | `lib/session.ts` | 識別子（32 バイトの乱数の base64url）・ハッシュ（`SESSION_SECRET` を鍵にした HMAC-SHA-256 の16進数）・Cookie の名前と属性・期限の定数（絶対 7 日・アイドル 24 時間） |
| バックエンド | `lib/auth-config.ts` | `SESSION_SECRET`（必須・16 文字以上）と本番かどうか。共通の `config.ts` は変えない（認証なしの生成物は `SESSION_SECRET` を要求しない）。足りなければ、値を表示せずにエラーにする |
| バックエンド | `db/session.repository.ts`・`services/session.service.ts` | Drizzle で D1・PostgreSQL の両方に動く書き方。作成・検証（期限・アイドル。最後に使った時刻の更新は 1 分に 1 回まで）・削除・利用者の全セッションの削除。時計を注入できる |
| バックエンド | `lib/auth-middleware.ts` | `requireAuth`（C-13）・`apiGuard`（`/api/*` の入口）・公開 API の許可リスト・`currentUser` |
| バックエンド | `routes/auth-session.ts` | `GET /api/auth/me`（`{ id, email }`。保護する API の見本）・`POST /api/auth/logout`（DB の行を消し、Cookie を消す。204。`originCheck` を通る。IdP はログアウトしない。C-16）・`authRoutes`（組み立て） |
| バックエンド | `index.ts`（認証ありの版） | `authRoutes` を `routes` の先頭に置く |
| フロントエンド | `features/auth/`（`api/auth.ts`・`useMe.ts`・`AuthGuard.tsx`・`LogoutButton.tsx`・`AccountInfo.tsx`）・`pages/LoginRequiredPage.tsx`・`pages/AccountPage.tsx`・`App.tsx`（認証ありの版） | 未認証（401）なら `/login` へ移す。`/login` の画面は、#74・#75 でログイン画面に置き換える（#73 は「ログインが必要です」の案内の画面）。`/account` が保護された画面の見本 |
| E2E | `e2e/auth-session.spec.ts` | 未認証の `/api/auth/me` が 401（no-store）、`/account` を開くとログインの案内に移る |
| Skill | `auth-session` | セッションの仕組み・保護する API の足し方（既定で拒否）・ログアウトの範囲（C-16）・トークン方式（JWT 等）を使わない理由（C-16・C-17）・使わない表は消してよいこと |

### 判断

- **認可は既定で拒否（C-13）**：`app.ts`（共通）は変えず、`authRoutes` が返す先頭の `/api` の入口（`apiGuard`）が、後ろに足したルートも含めて保護する。Hono は、先に登録した `use` の入口が、後ろのルートにも掛かる。許可リスト（`PUBLIC_API_PATHS`）は、名前そのものと、その下のパスだけが対象で、似た名前の別の API は保護される
- **`/api/sample-users` は保護せず、許可リストに理由つきで公開する**。動作確認の見本（E2E・smoke の確認が未認証のまま動く）で、実際の業務の API は `requireAuth` で保護する。保護する API の見本は `/api/auth/me`
- **`Cache-Control: no-store`（C-58）**：許可リストの外のすべての API（`/api/auth/*` を含む）に付ける。`security.ts` の `noStore` は、後続が例外（401 の AppError）を投げるとヘッダーを付けないため、`apiGuard` は `try / finally` で付ける（401 にも付く。テストで確かめている）
- **トークン方式を使わない**：すぐに無効にできる（C-16・C-17）・トークンのライフサイクルを作らなくてよい・同じドメインの構成で `HttpOnly` の Cookie が使える・IdP のトークンを使い回さない
- **PostgreSQL の結合テスト**：`pg` は vitest-pool-workers の中で読めないため、DB に触れるテスト（`session.repository.test.ts`・`auth-session.d1.test.ts`）は D1 の生成物だけに出す。`session.service`・`auth-middleware`・`auth-session` のテストは、メモリ上の Repository（`backend/test/fake-session-repository.ts`）で動かし、D1・PostgreSQL の両方で同じテストを出す。PostgreSQL の実際の DB は smoke が確かめる
- `requires` に `data-access/drizzle` を書かない：DB なしの認証ありは、整合性チェック `auth-needs-db` がエラーにする（プロファイルの不足のエラーで先に止めない）
- テストの利用者は `testuser_*`・`e2euser_*` の `@example.com`。`SESSION_SECRET` はテストの中で毎回生成する（実値をファイルに書かない）

### smoke：実 DB のセッションの確認（R2。認証ありの通り：d1+oidc・postgresql+app）

検証用の DB とサーバー（`npm run dev:test`）に対して行う（`checkTestIsolation` の中。`checkSessionAgainstRealDb`）。

1. smoke は `SESSION_SECRET` の架空の値（`.env.test` に書いた値）を知っているので、固定の架空の識別子（`smoke-session-0001` を 32 バイトにそろえて base64url にしたもの）の HMAC を計算し、`users`（`e2euser_session_001`）と `sessions`（有効・期限切れの2行）を、一時的な SQL（`e2e/seeds/` の下に作り、流した後に消す。`db-local.ts` の `seed-file` の規則は変えない）で入れる
2. `GET /api/auth/me` が 200（`id`・`email`・`Cache-Control: no-store`）、期限切れの Cookie が 401（行は検証のときに消える）、Cookie なしが 401
3. `POST /api/auth/logout`（`Origin` 付き）が 204、同じ Cookie で `/me` が 401、DB の `sessions` の行が消えている
4. `npm run db:cleanup:test` で `e2euser_` の行を消し、残りが 0 件

## `wrangler.jsonc` の組み立て

`buildWranglerJsonc`（`src/generate/wrangler.ts`）が、`buildProject` の中で作る。

1. `mergeWrangler` で、選んだプロファイルの `wrangler` と、回答に合う `wrangler_when` を深くまとめる
2. 先頭の項目を `name`・`main`・`compatibility_date`・`compatibility_flags`・`assets`・`vars` の順に並べ、残りは名前の昇順で並べる（同じ入力なら同じ結果になる）
3. 文字列の値だけに `{{名前}}`（`app_name`・`compatibility_date`・`allowed_origins` など）を差し込む。JSON にしてから置き換えると `"` や `\` で壊れうるため、まとめた設定の値を1つずつ置き換える（`fill`）
4. JSON にして、先頭に説明の `//` の行を付ける

PostgreSQL の手元の接続先は、`wrangler.jsonc` に書かない。Hyperdrive の `id` には仮の値（`HYPERDRIVE_ID`）を置く。手元では、環境変数 `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE`（Cloudflare が決めた名前）で渡す。本番の値は、デプロイの設定（#64 の IaC）で本物にする。

## Docker の構成

C-36 に合わせ、バックエンドを本番と同じ実行エンジン（workerd）で動かす。`docker-compose.yml` は、DB の回答で 2 つのひな形から選ぶ（`templates/project/docker-compose.yml`・`docker-compose.postgres.yml`。PostgreSQL のときだけ後者）。

- `name` はアプリ名。コンテナ名は `<アプリ名>-backend`・`<アプリ名>-db`
- backend：`node:<.node-version と同じ版>` のイメージ（`values.ts` の `node_version`）。`npm install` の後に `npm run dev -- --host 0.0.0.0` を動かし、`${APP_PORT:-5173}` を公開する
- ボリューム
  - `node_modules`：手元（Windows・macOS）の `node_modules` と分け、コンテナの中のものを使う
  - `wrangler_state`：`.wrangler/state` を保つ。コンテナを作り直しても D1 のデータが残る
  - `db_data`（PostgreSQL のとき）：`/var/lib/postgresql`
- D1 のとき、DB のコンテナは作らない。コンテナの中の D1 は、手元（`npm run dev`）の D1 とは別のデータである。初回は `docker compose exec -T backend npm run db:migrate:local`、次に `db:seed:local` で用意する（README にも書く）
- PostgreSQL のとき
  - `db` のイメージは `postgres:<版>`。版は `data/runtimes.yaml` の `postgres_image_tag` で固定する（`values.ts` の `postgresImageTag`）
  - `healthcheck`（`pg_isready`）を持ち、backend は `service_healthy` を待つ
  - `db` の口は `127.0.0.1:${POSTGRES_PORT:-5432}` にだけ開く（手元の `drizzle-kit` などがつなぐため。外のネットワークには開けない）
  - コンテナの中の backend には、接続先を `db` のサービス名に上書きして渡す（`DATABASE_URL` と Hyperdrive の手元の接続先。`.env` の `localhost` のままではつながらないため）
- 認証情報（`POSTGRES_USER`・`POSTGRES_PASSWORD`・`POSTGRES_DB`）は、compose に直接書かない。`${VAR:?メッセージ}` で `.env` から読み、なければ起動を止める（C-05）
- `.env.example` は、`data/env-items.yaml` の項目のうち、回答に合うものを、用途の説明と `名前=値` で並べる（`buildEnvExample`）。値は空か、`changeme`・`<…>` のプレースホルダだけで、項目ごとに `example` で指定する。compose が読む `${VAR}` は、すべて `.env.example` に項目がある（テストで確かめる）

## 例の機能

利用者が「機能を足す形」を、そのまま見られるようにする見本である。実際のアプリでは、消すか、自分の機能に置き換える。

### `/api/health`

DB の有無にかかわらず出る。`healthRoutes` → `getHealth`（`appEnv` を受け取る）の層を通る。画面の `HealthStatus`（`features/health`）が、`features/health/api/health.ts` と `services/api-client.ts` を通して呼んで表示する。

### `/api/sample-users`（DB ありのとき）

| メソッド | 内容 | 応答 |
| --- | --- | --- |
| GET | サンプルの利用者を一覧で読む（`listSampleUsers`） | 200 `{ users: [...] }` |
| POST | 1件追加する（`addSampleUser`） | 成功 201。入力の誤りは 422。送信元が許可されていないときは 403。同じユーザー名は 409 |

- 入力は `validate`（`lib/validation.ts`）で確かめる。`username` は 1〜50 文字の英数字とアンダースコア。誤りは 422 にする（Hono のプロファイルの既存の決まりに従う。すべての API に効く決まりを、例の機能のために変えない）
- 送信元は `app.ts` の `/api/*` の `originCheck` で確かめる（許可する送信元は `ALLOWED_ORIGINS`）
- 重複は、Service が一覧で確かめず、DB の一意の制約の違反を Repository が `DuplicateSampleUserError` で知らせ、Service が `AppError("CONFLICT")` にして 409 にする。一覧は先頭の件数までしか見えないため、一覧で確かめると 101 件目以降や同時の追加で漏れて 500 になる。DB の種類ごとのエラーの形の違い（D1 と PostgreSQL）は、Repository が吸収する
- `routes` は `db` を直接読まない。DB につなぐ処理（`withSampleUsers`）は、入口（`index.ts`）が `sampleUserRoutes` に渡す。テストは差し替えたものを渡す
- 以前の案にあった `/api/health/db` は使わない（この見本に置き換えた）

## 画面のセキュリティのヘッダー

API の応答には `securityHeaders` で CSP などが付くが、画面（HTML・JS・CSS）は Workers の静的アセットとして配信されるため、同じミドルウェアを通らない。そこで `public/_headers`（`frontend-build/vite-react-router` の `files/_headers`）で、すべてのパス（`/*`）に次のヘッダーを付ける。値は API の `securityHeaders` と同じにそろえる。

- `Content-Security-Policy`（`default-src 'self'` を基本に、`frame-ancestors 'none'`・`object-src 'none'`・`base-uri 'self'`・`form-action 'self'`）
- `Strict-Transport-Security`・`X-Frame-Options: DENY`・`X-Content-Type-Options: nosniff`・`Referrer-Policy`・`Permissions-Policy`

`npm run build` の出力に `dist/client/_headers` が入る（smoke で確かめる）。

## 後始末の SQL

`backend/db/seeds/cleanup.sql` は、テストデータだけを識別子（`testuser_` で始まるユーザー名）で消す（C-05）。`LIKE 'testuser_%'` の `_` は「任意の 1 文字」を意味するため、`testuserX001` のような似た名前の本物のデータも消してしまう。そこで `LIKE 'testuser!_%' ESCAPE '!'` とし、`_` を文字どおりに扱う。残数の確認の `SELECT COUNT(*)` も同じ条件にする。シードは何回流しても同じ結果になる（`ON CONFLICT (username) DO NOTHING`）。

## `npm run smoke:generated`（生成したプロジェクトの確認）

`scripts/smoke-generated.ts`。回答の YAML（架空の値）で 3 通り（D1・PostgreSQL・DB なし）のプロジェクトを、一時的なフォルダに生成し、実際に動かして確かめる。時間がかかるため `npm run check` には入れない。手元では `npm run smoke:generated` で、CI では手動で実行するワークフロー（`.github/workflows/smoke.yml`）で実行する（#82）。

### 確かめの内容（通りごと）

1. ハーネスの組み立て（`npm run build`）。そのあと `dist/cli.js` の `create --answers --yes` で生成する
2. 生成したプロジェクトで `npm install` → `npm run check` → `npm run build`（`dist/client/index.html` と `dist/client/_headers` ができること）
3. `.env` を作る（架空の値だけ。PostgreSQL のユーザー名・パスワード・DB 名・ポートは、ランダムな値。接続先が `localhost` などの手元であることを、つなぐ前に `assertLocalDatabaseUrl` で確かめる）
4. DB ありの通り（`checkDatabaseLifecycle`）：マイグレーションとシード → 開発サーバーで `/api/health`・`/`・シードしたデータの一覧 → 入力の誤り（422）・送信元の違い（403）・重複（409）→ 追加（API）・読み戻し・`db:cleanup`・消えたこと・`db:reset:local`（`runSampleUserLifecycle`）→ 初期化の後にもう一度開発サーバーを起動して同じ結果。DB なしは、開発サーバーで `/api/health`・`/` と、`/api/sample-users` が 404 であること
5. Docker（`dockerStage`）：`docker compose config` → `up -d` → `/api/health` を待つ → 画面と API → コンテナの中の `npm run check`。D1 は、コンテナの D1 を用意（マイグレーション・シード）して API で追加・読み戻し・後始末・初期化、そして `down` → `up` の後もデータが残ること。PostgreSQL は、コンテナの中の backend から `db` のコンテナの PostgreSQL に API でつながり、同じ追加・読み戻し・後始末・初期化を確かめる

失敗したときは、`runStage` が通りの名前（`d1` など）と段階を示した `SmokeError` にする。

### 環境変数

| 変数 | 内容 |
| --- | --- |
| `SMOKE_REQUIRE_DOCKER=1` | Docker が使えないときに、全部の通りを飛ばさず失敗にする（CI で使う）。Docker は D1・DB なしにも要る（#42） |
| `SMOKE_CASES=d1,none` | 実行する通りを絞る（既定はすべて） |

Docker が使えず `SMOKE_REQUIRE_DOCKER` もないときは、全部の通り（D1・DB なし・verify・local を含む）を飛ばす。生成したプロジェクトの `npm run check` が、Docker で動くセキュリティのテストを含むため（#42）。コンテナの中の品質チェックは、Docker を使わない `npm run check:app`。

### 実行ごとに一意のアプリ名

アプリ名は通りごとに一意（`createSmokeAppName`、`smoke-<乱数>` の形）にする。固定の名前だと、同時に実行したときに、コンテナ名・ボリュームが重なって干渉する。

### 後始末と中断

起動したものはすべて止め、一時的なフォルダは消す。

- `createCleanupRegistry`：起動したプロセス（`trackProcess`。子孫を一定の間隔で記録する）、Docker の資源（`trackCompose`。`docker compose down -v --remove-orphans`）、ほかの後始末（`add`）を記録する。`runAll` は、先にプロセスを止め、次に登録した後始末を逆順で実行する（一時的なフォルダは、プロセスが止まった後に消す）。`.env` ができた後でだけ `trackCompose` を登録する（`.env` がないと compose の変数が揃わず、`down` が失敗するため）
- `runWithCleanup`：確かめが成功しても失敗しても、必ず `runAll` を呼ぶ。確かめと後始末の両方が失敗したときは、両方の原因を出す
- `installInterruptHandlers`：SIGINT・SIGTERM を受けたら、`runAll` の完了を待ってから終了する（SIGINT は 130、SIGTERM は 143）。後始末の途中でもう一度信号を受けても、`runAll` は 1 回目の完了を待って同じ結果を返すため、完了前に終わらない。ハーネスの組み立て（`npm run build`）の段階も、同じ仕組みで止める
- `stopProcess`：Windows は `taskkill /T /F`、それ以外は子孫を集めて SIGTERM のあと SIGKILL。止められなければエラー

## CI の smoke の仕事

`.github/workflows/smoke.yml` の `smoke`。push・PR では動かさず、手動（`workflow_dispatch`。Actions の画面の「Run workflow」）で実行する（#82。時間がかかり環境に左右されるため、最終的な完成の前に通す）。`ubuntu-latest` だけで行う（`timeout-minutes: 60`）。`npm ci` の後に、smoke のスクリプトの単体テスト（`npm run test:smoke`。`test/scripts/smoke-generated*.test.ts`。`npm run check` には入れず、CI（ci.yml）では push・PR のたびにも実行する。#9）と `npm run smoke:generated` を実行し、環境変数 `SMOKE_REQUIRE_DOCKER`・`SMOKE_REQUIRE_TERRAFORM` に `1` を渡す。CI では Docker・Terraform が使えるはずなので、使えないときは飛ばさず失敗にする。

## テストと受け入れ条件の対応

| 受け入れ条件・見直し | テスト |
| --- | --- |
| AC-1 | `npm run smoke:generated`（開発サーバーの起動・`/api/health`・`/`・Docker）。`test/generate/skeleton.test.ts`：README の最初の手順、`index.html` が Vite の入口、`vite.config.ts` が Cloudflare の部品を使う |
| AC-2 | `npm run smoke:generated`（生成したプロジェクトで `npm run check` と `npm run build`。コンテナの中でも実行）。`skeleton.test.ts`：`npm run check` が lint・typecheck・test を含む、`tsconfig.json` が strict |
| AC-3 | `skeleton.test.ts`：有効な組み合わせ 17 通り、無効な組み合わせのエラー、回答ごとに出るファイル、`wrangler.jsonc` の `d1_databases`・`hyperdrive`・`r2_buckets`、`docker-compose.yml`、`.env.example`、`vitest.config.ts`、drizzle の設定、`package.json` の scripts。`test/generate/profile.test.ts`・`package-json.test.ts`・`plan.test.ts`・`conditional-profile.test.ts`：`files_when` などの読み込みとまとめ方。`test/generate/project.test.ts`：スナップショット |
| 秘密情報（C-05） | `skeleton.test.ts`：`.env.example` の値が空かプレースホルダだけ、compose に認証情報を直接書かない、実在しうるメールアドレス・ドメインがない |
| レビュー1-1：画面のヘッダー | `test/generate/skeleton-review1.test.ts`：`public/_headers` が全ての組み合わせで出て、API の `securityHeaders` と同じ値が入る |
| レビュー1-2：後始末の SQL | `skeleton-review1.test.ts`：`ESCAPE` を使い、DELETE と残数の確認が同じ条件。メモリ上の SQLite で、`testuser_001` は消え、`testuserX001` などは残る |
| レビュー1-3：アプリ名 | `test/scripts/smoke-generated-review1.test.ts`：実行ごとに一意なアプリ名 |
| レビュー1-4・2：中断 | 同上：中断で起動したものを止める。後始末の途中で信号を受けても完了を待つ |
| レビュー1-5：例の機能 | `skeleton-review1.test.ts`：サンプルの利用者のファイル、422・403、`/api/health/db` を使わない。`smoke-generated-review1.test.ts`：API 経由の追加・読み戻し・後始末（D1・PostgreSQL） |
| レビュー1-6：両方の失敗 | `smoke-generated-review1.test.ts`：確かめと後始末の両方が失敗したとき、両方の原因が出る |
| レビュー1-7：README | `skeleton-review1.test.ts`：D1 の Docker の手順 |
| レビュー2-2：重複 | `skeleton-review1.test.ts`：service が Repository の重複の知らせを CONFLICT にする。結合テストに 409 と 101 件より多い既存データのケース。smoke で 409 を D1・PostgreSQL の両方で確かめる |
| #73 認証：共通のセッションと認可 | `test/generate/auth-session.test.ts`（出るファイル・認証なしで出ない・マイグレーション・依存を足さない・秘密情報）、`test/scripts/smoke-generated-session.test.ts`（実 DB の確認の部品）。AC-1 の本体は、生成したプロジェクトの中のテストと smoke（下の「認証：共通のセッションと認可（#73）」） |
| smoke の部品 | `test/scripts/smoke-generated.test.ts`：回答の YAML、ポートの待ち合わせ、プロセスの停止、失敗の通り・段階の表示、接続先が手元であることの確認 |
| 共通仕様 | `skeleton.test.ts`：C-36 の書き直しの確認 |

テストの値・名前はすべて架空のもの（`testapp-001`・`testuser_*`・`@example.com`）。

## 関係する Issue と要件

| 区分 | 内容 |
| --- | --- |
| Issue | #56（このIssue）、#34（生成の仕組み。ひな形の差し込みの上に載せた）、#51・#57・#63・#64・#65・#66（範囲から分けたもの） |
| 機能要件 | F-09（DB の選択。DB のコンテナは PostgreSQL のときだけ）、F-24（技術プロファイル。`files_when` などの項目）、F-28（ひな形に条件の分岐を入れない）、F-27（管理するファイルではない）、F-20（アップロードの非公開の保存先は R2） |
| 共通仕様 | C-03（層構成）、C-05（秘密情報・テストデータ）、C-06（依存の向き）、C-27（入力の検証）、C-36（開発用の Docker）、C-62（版の固定）、C-69（プロセスの後始末） |

実装を正とする。この設計書とコードが食い違ったときは、コードの動きを正として設計書を直す。

## 引き継ぎ

- #51：環境変数の切り替え。`.env.example` と `data/env-items.yaml` の `example` の仕組みを使う
- #57：生成の直後の `npm install` と品質チェック。smoke の手順（`npm install` → `npm run check`）を参考にする
- #63：CI の実行場所・公開・GitHub による違い、要件定義書のひな形
- #64：Hyperdrive の本番の `id` などの IaC。E2E の最初のシナリオ
- #74・#75：独自認証・OIDC のログインの処理とテスト（#72 が生成の仕組みを、#73 が共通のセッションと認可を入れた）。#66：アップロードの処理とテスト。`wrangler.jsonc` の R2 のバインディングと、`SESSION_SECRET`・`OIDC_*` の項目はすでにある
- 例の機能（`/api/sample-users`）は、実際のアプリでは消すか置き換える
