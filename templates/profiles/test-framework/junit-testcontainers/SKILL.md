---
name: test-junit
description: Spring BootのテストをJUnit・Spring Boot Test・Testcontainersで書くときのルール。Controllerのテスト、アプリ全体のテスト、DBを使うテストを書くときに読む。
---

# JUnit・Testcontainers

作業の過程と結果は、すべて日本語で書く。{{profile_skill_note}}

## 用意されているテスト（`backend/src/test/java/{{java_package_path}}/`）

| ファイル | 内容 | Docker |
| --- | --- | --- |
| `health/HealthControllerTest.java` | `@WebMvcTest`でControllerだけを起動し、`GET /api/health`の応答を確かめる。新しいControllerのテストの手本 | 不要 |
| `ApplicationTests.java` | `@SpringBootTest`でアプリ全体を起動し、設定の誤りで失敗しないことを確かめる | 不要 |
| `PostgresContainerTest.java` | TestcontainersでPostgreSQLを起動し、JDBCでつながることを確かめる。DBを使うテストの手本 | 必要 |

## 守ること

- **MUST**：テストは`backend/`の`./gradlew check`で動かす。`check`は`test`に依存している
- **MUST**：Controllerのテストは`@WebMvcTest`、アプリ全体の確認は`@SpringBootTest`を使い分ける。`@SpringBootTest`は起動が遅いため、必要な範囲だけにする
- **MUST**：DBを使うテストは、Testcontainersで起動した使い捨てのDBに対して行う。手元の開発用DB・共有のDB・本番のDBに接続しない
- **MUST**：テストデータは架空の値にする（氏名は`testuser_001`、メールアドレスは`@example.com`など）。実在の個人情報・本物の認証情報を使わない
- **MUST NOT**：テストの期待値や設定に、パスワード・トークンなどの実値を書かない
- Testcontainersで使うイメージ（`postgres:{{postgres_image_tag}}`）は、タグで固定する。`latest`にしない
