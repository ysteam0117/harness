## Gradle の使い方

バックエンド（Java）のビルドは、`backend/` の Gradle で行います。Gradle Wrapper（`gradlew`）は、ハーネスが出さないため、最初に1回だけ作ります。

1. `backend/` で `gradle wrapper` を1回実行して、`gradlew`（Windows は `gradlew.bat`）を作る（Gradle が入っていることが前提です）
1. その後は、`backend/` で `./gradlew check`（Windows は `gradlew.bat check`）を実行して、確かめる

