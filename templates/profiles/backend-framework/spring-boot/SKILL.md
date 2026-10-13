---
name: backend-spring-boot
description: Spring BootでバックエンドのAPIを作るときのルール。Controller・Service、入力チェック（Bean Validation）、エラー応答、設定、ビルド（Gradle）を扱うときに読む。
---

<!-- もとになった共通仕様：C-03・C-15・C-27〜C-29 -->

# Spring Boot

作業の過程と結果は、すべて日本語で書く。{{profile_skill_note}}

## 構成

| 場所 | 中身 |
| --- | --- |
| `backend/build.gradle.kts` | ビルドの設定。プラグインと依存は、`gradle/libs.versions.toml`の別名（`libs.…`）で書く |
| `backend/src/main/java/{{java_package_path}}/` | アプリのコード。入口は`Application.java`、機能ごとにパッケージを分ける（例：`health/`） |
| `backend/src/main/resources/application.yaml` | 設定。秘密の値は書かず、環境変数で渡す |
| `backend/src/test/java/{{java_package_path}}/` | テスト（Skill「test-junit」） |

- Javaのパッケージは`{{java_package}}`。新しい機能は、このパッケージの下に機能の名前のパッケージを作って置く
- 依存の版は、Spring Bootの BOM が決める。`libs.versions.toml`の依存に版を書かない。BOM が管理しない依存を足すときは、利用者と相談して版を決め、理由をADRに記録する

## 守ること

- **MUST**：Controller（`@RestController`）は、入力の受付と応答の返却だけにし、業務の処理はService（`@Service`）に渡す。ControllerからRepositoryやDBを直接呼ばない
- **MUST**：入力は Bean Validation（`@Valid`と`jakarta.validation`の制約）で確かめる。使うときは、依存に`org.springframework.boot:spring-boot-starter-validation`を足す
- **MUST**：エラーは例外で投げ、`@RestControllerAdvice`で、決めた形式のエラー応答（Skill「error-api」）に変える。各層で`try`〜`catch`して500にしない
- **MUST NOT**：エラー応答に、スタックトレース・内部の例外メッセージ・SQLを含めない
- **MUST**：APIのパスは`/api/`で始める（画面の開発サーバーは、`/api`をこのアプリ（既定は`http://localhost:8080`）へ中継する）
- **MUST**：環境ごとに変わる値（接続先・許可する送信元など）は、`application.yaml`に実値を書かず、環境変数（`${名前:既定値}`）で受け取る
- **MUST NOT**：ログ・応答・テストの期待値に、パスワード・トークン・個人情報を出さない（Skill「logger」）

## 起動と確認

- `backend/`で`./gradlew bootRun`を実行すると、`http://localhost:8080`で起動する。確認は`GET /api/health`（`{"status":"ok","appEnv":"…"}`）
- 画面は、リポジトリの直下で`npm run dev`を実行して起動する（Viteの proxy で`/api`が`:8080`に届く）
- 品質チェック（ビルドとテスト）は`backend/`で`./gradlew check`。Dockerが動いている必要がある（Skill「test-junit」）

## 範囲外（今は用意していないもの）

- 認証、データアクセス（DBのライブラリ）、Dockerの開発環境、デプロイの設定は、まだない。必要になったら、利用者と相談して技術を選び、理由をADRに記録する
