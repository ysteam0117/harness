<!-- もとになった共通仕様：C-61・C-62・C-69・C-82 -->

# セキュリティのテストの手順書

コードの書き方・秘密情報の混入・依存ライブラリの脆弱性を、品質チェック（`{{check_command}}`）の中で毎回確かめる。道具は Docker の公式イメージで動かす（版とダイジェストで固定）。

## 1. 必要なもの

| もの | 版 | 入れ方 |
| --- | --- | --- |
| Node.js | `.node-version` の版 | PC に直接入れる |
| **Docker**（D1・DB なしのプロジェクトでも必須） | 新しいもの | Windows・macOS は Docker Desktop、Linux は Docker Engine を入れて、起動する |
| 通信 | — | 初回にイメージを取得する。OSV-Scanner は、実行のたびに OSV のデータベースへ通信する |

**Docker Desktop のライセンスに注意する**：従業員250人以上、または年間売上1000万ドル以上の会社が、業務で使うときは有料になる（個人・小規模・教育・非営利は無料）。条件は変わることがあるため、導入の前に Docker の公式の案内で確かめる。Linux の Docker Engine は、この条件の対象ではない。

Docker が入っていない・動いていないときは、`npm run security` が、理由と導入の案内を表示して失敗する。スキップする抜け道（環境変数など）は用意していない。

## 2. 構築の手順

1. Docker を入れて、起動する
1. `docker info` が成功することを確かめる
1. `npm install`
1. `npm run security` を実行する（初回は、3つのイメージを取得するため、時間がかかる）

## 3. 確認の方法

- `docker info` が成功する（Docker が動いている）
- `npm run security` の最後の「セキュリティのテストの要約」の4行がすべて `OK` になる

## 4. 実行方法

| コマンド | 内容 |
| --- | --- |
| `{{check_command}}` | `npm run check:app`（Docker を使わない品質チェック）に、`npm run security` を足したもの。**ホストで実行する** |
| `npm run security` | 次の3つ（と、Git に入った秘密のファイルの確認）をすべて実行する。1つでも失敗すると、終了コード1 |
| `npm run security:semgrep` | Semgrep だけ |
| `npm run security:secrets` | gitleaks と、Git に入った秘密のファイルの確認だけ |
| `npm run security:osv` | OSV-Scanner だけ |

Docker のコンテナの中（`docker compose` で動かした開発用のコンテナ）では、Docker を使えないため、`npm run check:app` を実行する。`{{check_command}}` は、ホストで実行する。

## 5. 道具と合否の基準

| 道具 | 何を確かめるか | 合格の基準 | 通信 |
| --- | --- | --- | --- |
| Semgrep | コードの書き方（XSS・危険な関数・コマンドの組み立てなど） | 重大度が高い（ERROR）指摘が0件 | なし（ルールを `.semgrep/` に同梱し、`--network none` で実行する） |
| gitleaks | 作業ツリーの、パスワード・API キー・トークンなどの混入 | 検出が0件 | なし |
| OSV-Scanner | `package-lock.json` の、本番の依存の既知の脆弱性 | CVSS の重大度 **7.0 以上**（高・重大）が0件 | あり（OSV のデータベース） |
| Git に入った秘密のファイル | `.env`・`.env.*`（`.env.example` を除く）・`.dev.vars` が Git に追加されていないこと | 0件 | なし |

- 値（秘密情報の中身）は、画面にもログにも出さない。gitleaks の結果は、ファイル名・行・ルールの名前だけを表示する
- gitleaks は、Git に入らないもの（`.env`・`.dev.vars`・`node_modules/`・組み立ての結果など）と、ハーネスの記録（`.harness/config.yaml`。ファイルの指紋のハッシュ値だけが入る）を、`.gitleaks.toml` のパスの例外で検査から外している。`.env.example` は検査する
- OSV-Scanner は、開発用の依存（`package-lock.json` の `dev`）を除く。重大度が付いていない指摘・7.0 未満の指摘は、記録として表示し、失敗にはしない。`npm audit --omit=dev`（`check:app` に含む）も、そのまま残す
- OSV-Scanner の「通信の失敗」と「脆弱性の検出」は、表示で区別する（どちらも失敗になる）。通信の失敗のときは、通信を確かめて、もう一度実行する
- 脆弱性が見つかったら、直った版へ更新する。バージョンを変えるときは、固定したまま動作を確かめる（`docs/project-rules.md`・C-62）

### Semgrep のルール

`.semgrep/` のルールは、公開のルール集（semgrep/semgrep-rules）から選んだ、重大度が高い（ERROR）ものだけである。各ファイルの先頭のコメントに、出どころ・版（コミット）・ライセンスを書いてある（`.semgrep/NOTICE.md` に、ライセンスの条件を写してある）。

- **ライセンス**：同梱しているものは、LGPL 2.1 に Commons Clause の条件を付けたもの。2024-12-13 より後の版は、ルールの配布を認めない別のライセンスのため、取り込まない。ルールを足す・更新するときは、取り込む版のライセンスを確かめる
- ルールは、ハーネスが管理するファイルである。書き換えない（ハーネスの更新で置き換わる）
- 公開のルールは、Express などを前提にしたものが多く、Hono の書き方（`c.req.query()` など）を直接は見つけない。SQL の組み立て・入力チェックの書き方は、Skill のセキュリティ・バックエンドの良い例・悪い例のテスト（`backend/src/rules-examples/`）とコードレビューで確かめる

## 6. 誤検知の抑え方（理由は必須）

| 道具 | 抑え方 |
| --- | --- |
| Semgrep | 該当の行（または直前の行）に `// nosemgrep: <ルールの id> <理由>` を付ける。ルールの id は、失敗の表示の `semgrep.` の後ろ（例：`semgrep.insecure-innerhtml` なら `insecure-innerhtml`）。1か所で複数のルールが当たったときは、すべての id を `,` で区切って並べる。例：`// nosemgrep: insecure-innerhtml, insecure-document-method 固定の文字列だけを入れる（利用者の入力は入れない）` |
| gitleaks | テスト用の架空の値は、値に `FAKE_SECRET_FOR_TEST` を含める（`.gitleaks.toml` の例外）。ファイル全体の除外は足さない |
| OSV-Scanner | 更新する。更新できないときは、理由と期限を ADR に記録して、利用者の承認を得る |

- **理由のない抑止はしない**。`nosemgrep` だけ・ファイル全体の除外・ルールの削除・`.gitleaks.toml` の例外の追加は、コードレビューで、理由が妥当かを確かめる。確かめた内容は {{pr_equivalent}} に記録する
- 本物の秘密が見つかったときは、抑えずに、その秘密を取り消して（再発行して）、環境変数（`.env`）に移す

## 7. ダミーの秘密情報

テストやドキュメントに、秘密情報の形をした値が必要なときは、**架空の値**だけを使い、値に `FAKE_SECRET_FOR_TEST` を含める（例：`FAKE_SECRET_FOR_TEST_0001`）。本物の形式（`ghp_` で始まるトークンなど）に似せない。実在するサービスの値・実在のメールアドレスは使わない。

## 8. 検出が働いていることを確かめる方法

道具が実際に検出できることを、わざと問題を入れて確かめる。**確かめたら、必ず消す**。

1. **危険な書き方**：`frontend/src/` に、次の内容のファイル（例：`danger-check.ts`）を作る。`npm run security:semgrep` が失敗する。確かめたら、ファイルを消す

   ```ts
   export function show(element: HTMLElement, html: string): void {
     element.innerHTML = html;
   }
   ```

2. **秘密情報らしい値**：`ghp_` と英数字36文字（GitHub の個人用トークンの形式。実在のトークンではない値）を、**乱数でその場で作って**ファイルに書く。値は、画面・ログ・チャット・コミットに出さない。`FAKE_SECRET_FOR_TEST` は含めない。`npm run security:secrets` が失敗する（ファイルの場所とルールの名前だけが表示される）。確かめたら、ファイルを消す

   ```text
   node -e "const { randomInt } = require('node:crypto'); const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'; let token = 'ghp_'; for (let i = 0; i < 36; i++) token += chars[randomInt(chars.length)]; require('node:fs').writeFileSync('backend/src/tmp-secret-check.ts', 'export const value = ' + JSON.stringify(token) + ';\n')"
   ```

   確かめた後：`node -e "require('node:fs').rmSync('backend/src/tmp-secret-check.ts')"`

3. **脆弱な版の依存**：脆弱性の公表された古い版を、本番の依存に入れる（例：`npm install --save-exact lodash@4.17.15`）。`npm run security:osv` が失敗する。確かめたら、`npm uninstall lodash` で戻す
4. **Git に入った秘密のファイル**：Git のリポジトリで、`.env.development` のような秘密のファイルを `git add -f` で追加すると、`npm run security:secrets` が失敗する（値は見ない）。確かめたら、`git rm --cached` で外す

## 9. 依存ライブラリの更新の通知（Dependabot）

{{security_dependabot_section}}

## 10. 固定したイメージ（版・ダイジェスト・確かめた日と方法）

イメージは、`scripts/security-check.mjs` に、版（tag）とダイジェストで固定している。値の出どころは、ハーネスの技術プロファイル（`container_images`）である。

| 道具 | イメージ | 確かめた日 |
| --- | --- | --- |
| Semgrep | `{{semgrep_image}}` | {{semgrep_checked_on}} |
| gitleaks | `{{gitleaks_image}}` | {{gitleaks_checked_on}} |
| OSV-Scanner | `{{osv_scanner_image}}` | {{osv_scanner_checked_on}} |
| Schemathesis | `{{schemathesis_image}}` | {{schemathesis_checked_on}} |

- 確かめ方：`docker pull <image>:<tag>` で取得し、`docker inspect <image>:<tag>` の出力の `RepoDigests` にあるダイジェストを、固定した値と比べる。`--version` などで版を確かめる
- 更新するときも、同じ手順で、新しい版とダイジェストを確かめてから、プロファイルの値を直す。Dependabot はこのイメージを更新しない（手で更新する）

## 11. 後始末

起動したままのものはない（コンテナは `--rm` で実行し、終わると消える）。取得したイメージは、`docker image rm <イメージ>` で消せる。確かめのために作ったファイルは、消す（8 の手順）。

## 12. よくある失敗と対処

| 失敗 | 確かめ方・対処 |
| --- | --- |
| 「Docker が見つかりません」「Docker が動いていません」 | Docker を入れて、起動する。`docker info` が成功することを確かめる |
| 初回に長い時間がかかる・イメージの取得に失敗する | 通信を確かめる。取得したイメージは、2回目からは再利用される |
| OSV-Scanner が「通信か実行の失敗」と表示する | OSV のデータベースへの通信を確かめて、もう一度実行する（脆弱性の検出ではない） |
| Windows の Git Bash で、パスが変わって失敗する | スクリプトは `MSYS_NO_PATHCONV=1` を付けて実行している。自分で `docker run` を実行するときは、同じ指定を付ける |
| Semgrep の指摘が誤検知だった | 6 の手順で、理由つきの `nosemgrep` を付ける |
