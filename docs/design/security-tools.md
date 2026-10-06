# 設計書：セキュリティのテストの道具（Issue #42）

## 目的と範囲

C-82 で採用を決めた道具（Semgrep・gitleaks・OSV-Scanner・Dependabot・Schemathesis）を、技術プロファイル（F-24）の `quality/typescript-standard` に足し、生成するプロジェクトの品質チェックの1つのコマンド（C-61）に含める。

- 作らないもの：OWASP ZAP（攻撃を試すテスト）、ペネトレーションテスト（#40 で手順書のひな形を作った）、Schemathesis の自動実行（`npm run check` に入れない。手動の手順だけを書く）

| 番号 | 内容 |
| --- | --- |
| AC-1 | 各道具がプロファイルに入り、確かめた版（tag とダイジェスト）・確かめた日・方法が `container_images` に残る。`check` に `security` が入り、生成物に実行のスクリプト・設定・ルール・仕様書・手順書が出る |
| AC-2 | 試作のプロジェクトで、品質チェックから Semgrep・gitleaks・OSV-Scanner が動き、わざと入れた問題（危険な書き方・乱数で作った秘密らしい値・脆弱な版）で失敗する |
| AC-3 | Schemathesis を、試作の API に対して、手順書のとおりにローカルで実行できる |

## 方針

- 3つの道具は、公式の Docker イメージ（tag とダイジェストで固定）で実行する。Docker が使えないときは、導入を案内して失敗する。D1・DB なしでも Docker が要る。スキップの環境変数は作らない
- 品質チェックを2段にする（R1）：`check:app`＝これまでの `check` の中身（Docker を使わない。コンテナの中でも動く）、`check`＝`npm run check:app && npm run security`（ホストで実行する）。docker-compose のコンテナの中・smoke のコンテナの中では `check:app`
- 新しい npm の依存は足さない（実行は Node の標準だけ）

## 出すファイル

| 出力先 | ひな形 | 条件 | 区分（F-27） |
| --- | --- | --- | --- |
| `scripts/security-check.mjs` | `profiles/quality/typescript-standard/files/security-check.mjs` | 常に | 管理する |
| `.gitleaks.toml` | `profiles/quality/typescript-standard/files/gitleaks.toml` | 常に | 管理する |
| `.semgrep/*.yaml`・`.semgrep/NOTICE.md` | `profiles/quality/typescript-standard/files/semgrep/` | 常に | 管理する |
| `.github/dependabot.yml` | `templates/.github/dependabot.yml` | `repository` が `github` | 管理する |
| `docs/api/openapi.json` | `templates/docs/api/openapi.*.json`（部品を回答で重ねる。`src/generate/openapi.ts`） | 常に | プロジェクトのもの |
| `backend/src/openapi.test.ts` | `templates/project/backend/openapi.test.ts` | 常に | プロジェクトのもの |
| `docs/testing/security.md`・`docs/testing/schemathesis.md` | `templates/docs/testing/` | 常に | プロジェクトのもの |

## 実行のスクリプト（`scripts/security-check.mjs`）

- 順序：Git に追加された秘密のファイルの確認（Docker を使わない）→ `docker info` → gitleaks → Semgrep → OSV-Scanner → 要約（道具ごとの OK・NG と所要時間）。1つでも失敗なら終了コード1。引数（`semgrep`・`secrets`・`osv`）で1つだけ実行できる
- 実行は `spawnSync` の引数の配列（shell なし）。`runner` を差し替えられる形にして、単体テストでは本物の Docker を使わない（`test/generate/security-check.test.ts`）
- マウントは `-v <cwd>:/src:ro -w /src --rm`。Windows のパスはそのまま渡し、環境に `MSYS_NO_PATHCONV=1` を足す
- Semgrep：`--config /src/.semgrep --severity ERROR --error --metrics=off --disable-version-check`、`node_modules`・`dist`・`.wrangler` を除外、`--network none`
- gitleaks：`dir /src --config /src/.gitleaks.toml --redact --no-banner --exit-code 1 --report-format json --report-path -`、`--network none`。結果の JSON から、ファイル・行・ルールの名前だけを表示する（値は読まない・出さない）
- OSV-Scanner：`scan source --lockfile /src/package-lock.json --format json`（通信あり）。`package-lock.json` の `dev` だけの依存を除き、CVSS の重大度 7.0 以上を失敗にする。重大度のないものは記録だけ。結果を得られないとき（通信・実行の失敗）は、脆弱性の検出と区別して表示する
- Git に追加された秘密のファイル（R2）：`git ls-files` に `.env`・`.env.*`（`.example` で終わるものを除く）・`.dev.vars`・`.dev.vars.*` があれば失敗（名前だけを表示）。Git のリポジトリでないときは飛ばす

## 秘密のファイルの扱い（R2）

- `.gitleaks.toml` のパスの除外（`.env`・`.dev.vars`・`node_modules/` など）は、作業ツリーの検査だけに使う。除外したファイルが Git に入ることは、`security-check.mjs`（`git ls-files`）と `pre-commit`（GitHub を使わない場合。`git diff --cached --name-only` で判定。gitleaks の有無に関係なく止める）が止める
- `pre-commit` の gitleaks は、`.gitleaks.toml` のパスの除外を使わない。環境変数 `GITLEAKS_CONFIG_TOML` で、標準のルールと `FAKE_SECRET_FOR_TEST` の値の目印だけの設定を渡す
- `.harness/config.yaml`（管理するファイルの指紋のハッシュ値）は、汎用のキーとして誤検出されるため、パスで除外する

## Semgrep のルール

- 公開のルール集 semgrep/semgrep-rules の、2024-12-13 のコミット（0f5a85ce…）から、重大度が ERROR の JavaScript・TypeScript・React のルールを10個選び、中身を変えずに `.semgrep/` に同梱する。各ファイルの先頭に、出どころ・版・ライセンスを書く
- ライセンス：このコミットは LGPL 2.1 に Commons Clause の条件を付けたもの（配布できる）。これより後の版は Semgrep Rules License v1.0（ルールの配布を認めない）のため、取り込まない
- Express などを前提にしたルールが多く、Hono の書き方を直接は見つけない。SQL・入力チェックは、Skill の良い例・悪い例のテストとコードレビューで確かめる
- 誤検知は、理由つきの `// nosemgrep: <ルールの id> <理由>` だけで抑える。理由が妥当かは、コードレビューで確かめる（Skill「quality-tools」）

## イメージの固定（R3）

- プロファイルの `container_images`（道具の名前 → `image`・`tag`・`digest`・`checked_on`・`note`）。`src/generate/profile.ts` が読み込み、tag（`latest` は不可）・ダイジェスト（`sha256:` と64桁の16進）・日付の形を確かめる。形が違えば、場所を示した `GenerateError`
- ひな形には、値 `{{<道具>_image}}`（`image:tag@digest`）・`_tag`・`_digest`・`_checked_on` として差し込む（`containerImageValues`）。`buildOutputs`（プロファイルの files）と `buildProject`（文書）の両方で使う
- 更新の手順：`docker pull` で取得 → `docker inspect` の `RepoDigests` を確かめる → `--version` を確かめる → 値と確かめた日を直す。Dependabot はこのイメージを更新しない

## API の仕様書と Schemathesis

- 仕様書は OpenAPI 3.1 の JSON（`docs/api/openapi.json`。生成するプロジェクトに YAML を読む依存がなく、Vite が JSON をそのまま読めるため）。実際に組み込まれるルートだけを書く（R4）：`/api/health`（常に）、`/api/sample-users` の GET・POST（DB あり）、`/api/auth/me`・`/api/auth/logout`（認証あり）
- `backend/src/openapi.test.ts` が、Hono の `app.routes` と仕様書の `paths` を突き合わせ、状態を変える操作の 403・`/api/auth/` の 401 が書かれていることも確かめる。ルートの組み立ては、DB につなぐ処理を使わない代役にした `index.ts` と同じもの（ハーネスの `data/template-values.yaml` の `openapi_test_*`）
- 手順書（`docs/testing/schemathesis.md`）：Docker のイメージ（版とダイジェスト固定）で実行する。Windows・macOS は `host.docker.internal`、Linux は `--network host`。すべての要求に許可した Origin を付ける（R5）。開発サーバーは `--host 127.0.0.1` で起動する。本番に向けない
- 試作で見つかったこと：開発サーバー（Vite）は `localhost` 以外の Host 名の要求を断るため、`Host` ヘッダーをそろえる。`TRACE` は開発サーバー（Cloudflare の Vite プラグイン）が 500 を返すため、`coverage` の段階を使わない（`--phases examples,fuzzing`）。壊れた JSON の本文が 500 になる不具合（`error-handler.ts`）を見つけ、422（`VALIDATION_ERROR`）にした

## テスト

| 番号 | テスト |
| --- | --- |
| AC-1 | `test/generate/container-images.test.ts`・`test/generate/security-tools.test.ts`（スクリプト・ファイル・管理の区分・Dependabot・仕様書とルート・文書）、`test/generate/security-check.test.ts`（実行のスクリプト。Docker なし・集計・OSV の判定・R2・R6） |
| R2 | `test/generate/local-git.test.ts`（`pre-commit` が `.env` のステージで止まる） |
| smoke・verify | `test/scripts/smoke-generated-security.test.ts`、`test/verify/verify.test.ts`・`test/commands/create-verify.test.ts`（Docker の確認を DB に関係なく行う） |
| AC-2・AC-3 | 試作のプロジェクトでの手動の確認（D1・PostgreSQL、認証なし・あり）。手順は `docs/testing/security.md` の「検出が働いていることを確かめる方法」と `docs/testing/schemathesis.md` |
