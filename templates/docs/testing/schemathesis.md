<!-- もとになった共通仕様：C-62・C-69・C-82 -->

# API の異常な入力のテスト（Schemathesis）の手順書

API 仕様書（`docs/api/openapi.json`）から、異常な入力（範囲外・型違い・壊れた本文など）を大量に作って、動いている API に送り、**500 エラーや、仕様と違う応答がない**ことを確かめる。

- 時期：リリースの前（検証環境）。手元（ローカル）でも実行できる
- `npm run check` には**入れない**（開発サーバーを起動して実行するため、品質チェックとは別に行う）
- **本番には向けない**。向けてよいのは、手元の開発サーバーと、検証環境だけ。外部のサービスにも向けない。検証環境に向けるときは、実行する前に利用者の承認を得る

## 1. 必要なもの

| もの | 版 | 入れ方 |
| --- | --- | --- |
| Docker | 新しいもの | Docker Desktop（Windows・macOS）か Docker Engine（Linux）。詳しくは [security.md](security.md) |
| Schemathesis（Docker のイメージ） | `{{schemathesis_image}}`（{{schemathesis_checked_on}} に確かめた版） | `docker run` の初回に取得される |
| API 仕様書 | `docs/api/openapi.json` | プロジェクトにある。API を足す・変えるときは、同じ変更の中で直す |

## 2. 構築の手順

1. `.env.development` を用意し（`.env.example` から。`docs/secrets.md`）、DB があるときは、マイグレーションとシードを済ませる（`README.md` の「最初の手順」）
1. 開発サーバーを起動する（Docker のコンテナから届くよう、手元のアドレスで待ち受ける）

   ```text
   npm run dev -- --host 127.0.0.1
   ```

1. 許可する送信元（Origin）を確かめる：`.env.development` の `ALLOWED_ORIGINS` の値（既定は `http://localhost:5173`）。以降の `<Origin>` は、この値

## 3. 確認の方法

- `http://localhost:5173/api/health` が 200 を返す
- 状態を変える要求（POST など）は、**許可した Origin がないと 403 になる**（C-28）。Schemathesis には、許可した Origin を、すべての要求に付けて渡す（付けないと、POST の API は、すべて 403 になる）。Origin を付けない・別の Origin を付けると 403 になることを、次のコマンドで確かめられる（`/api/*` の POST は、API の中身より先に、Origin を確かめる）

  ```text
  curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:5173/api/health
  curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "Origin: https://other.example.com" http://localhost:5173/api/health
  ```

  どちらも `403` になれば、Origin の確認が効いている（Windows の PowerShell では `curl.exe` を使う）

## 4. 実行方法

プロジェクトのフォルダで、次を実行する。`<Origin>` は、2 で確かめた値。

**Windows（PowerShell）・macOS（Docker Desktop）**：Docker のコンテナから、手元のサーバーには `host.docker.internal` で届く。開発サーバー（Vite）は、`localhost` 以外の Host 名の要求を断るため、`Host` ヘッダーを `localhost:5173` にそろえる。

```text
docker run --rm -v "${PWD}/docs/api:/api:ro" {{schemathesis_image}} run /api/openapi.json --url http://host.docker.internal:5173 -H "Origin: <Origin>" -H "Host: localhost:5173" --phases examples,fuzzing
```

（macOS・Linux の bash・zsh では `${PWD}` を `$(pwd)` にする。Windows の Git Bash では、先頭に `MSYS_NO_PATHCONV=1` を付け、`${PWD}` を `$(pwd -W)` にする）

**Linux（Docker Engine）**：`--network host` で、コンテナが手元のネットワークをそのまま使う。`host.docker.internal` と `Host` ヘッダーの指定は要らない。

```text
docker run --rm --network host -v "$(pwd)/docs/api:/api:ro" {{schemathesis_image}} run /api/openapi.json --url http://localhost:5173 -H "Origin: <Origin>" --phases examples,fuzzing
```

- 結果：`No issues found` で終了コード 0 なら合格。失敗したときは、出力の `Reproduce with:` の `curl` の行で、同じ要求を再現できる
- `--phases examples,fuzzing`：`coverage` の段階は使わない。開発サーバー（Cloudflare の Vite プラグイン）が、仕様書にないメソッド（`TRACE`）の要求に、アプリの手前で 500 を返すため、アプリの不具合ではない失敗が出る。リリース前の検証環境（`wrangler` で動かす本番と同じ実行エンジン）に向けるときは、`--phases` を外して、すべての段階を実行してよい
- 要求の数・時間を増やすときは、`--max-examples 500` を足す
- 認証があるプロジェクト（`/api/auth/` がある）：認証が必要な API は、セッションなしだと 401 になる。仕様書に 401 を書いてあるため、そのままで実行できる（「Missing authentication」の警告が出るが、仕様どおりの動きで、失敗ではない）。認証が必要な API の正常系も確かめるときは、検証用の利用者でログインして得たセッションの Cookie を `-H "Cookie: <Cookie>"` で渡す（値は、チャット・ファイル・コミットに書かない）

## 5. 後始末

- 開発サーバーを止める（起動したターミナルで Ctrl+C）。止めた後、ポート（5173）が解放されたことを確かめる
- Schemathesis のコンテナは、`--rm` で実行しているため、終わると消える
- Schemathesis は、`POST` の API で、開発用の DB に、ランダムな値のデータを足す。`npm run db:reset:local`（D1・PostgreSQL。開発用の DB を作り直す）で戻す。テスト用の接頭辞（`testuser_`）のデータだけを消す `npm run db:cleanup` では、消えない

## 6. よくある失敗と対処

| 失敗 | 確かめ方・対処 |
| --- | --- |
| すべて 403 になる | `-H "Origin: <Origin>"` を付けているか。`.env.development` の `ALLOWED_ORIGINS` と同じ値か |
| `Network unreachable`・接続できない | 開発サーバーを `--host 127.0.0.1` で起動しているか。`localhost` だけで起動すると、コンテナから届かないことがある（IPv6 のみで待ち受けるため） |
| `Blocked request. This host is not allowed`（403・text/plain） | Windows・macOS の手順の `-H "Host: localhost:5173"` を付けているか |
| 500 が見つかった | アプリの不具合。`Reproduce with:` の `curl` で再現し、直す。再発を防ぐテストを足す（C-82） |
| 仕様と違う応答が見つかった | 仕様書か実装のどちらかが誤り。仕様書を直すときは、実際のルートと合わせる（`backend/src/openapi.test.ts`） |
