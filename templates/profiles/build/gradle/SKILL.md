---
name: build-gradle
description: Gradleでビルドとテストを動かすときのルール。./gradlew check の使い方、Gradle Wrapper の作り方、依存とプラグインの足し方を扱うときに読む。
---

# Gradle

作業の過程と結果は、すべて日本語で書く。{{profile_skill_note}}

## 使い方

- Gradleのファイルは`backend/`にある：`build.gradle.kts`（ビルドの設定）・`settings.gradle.kts`（プロジェクトの名前と、依存・プラグインの取得元）・`gradle/libs.versions.toml`（依存・プラグインの版）
- Gradle Wrapper（`gradlew`・`gradlew.bat`）は、生成していない。`backend/`で、Gradleを入れた環境から`gradle wrapper`を1回実行して作り、リポジトリに入れる（`README.md`の「Gradleの使い方」）
- ビルドとテストは、`backend/`で`./gradlew check`を実行する（Windowsは`gradlew.bat check`）。テストにはDockerが要る

## 守ること

- **MUST**：依存とプラグインの版は、`gradle/libs.versions.toml`に書く。`build.gradle.kts`には`libs.…`の別名で参照し、版の数字を直接書かない
- **MUST**：依存とプラグインの取得元は、`settings.gradle.kts`の Maven Central だけにする。ほかの取得元を足すときは、利用者と相談し、理由をADRに記録する
- **MUST**：版の更新は、`docs/tech-stack.md`の記録と合わせる。Spring Bootの BOM が決める依存には、版を書かない
- **MUST NOT**：`gradle.properties`・`build.gradle.kts`に、パスワード・トークンなどの秘密の値を書かない
