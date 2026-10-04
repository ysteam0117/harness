---
name: frontend
description: フロントエンド（React・TypeScript）の設計・実装・レビューのルール。ディレクトリ構成、コンポーネント、型、状態管理、Hooks、API通信（Axios）、フォーム、画面の状態、アクセシビリティ、アイコンを扱うときに読む。
---

<!-- もとになった共通仕様：C-06・C-43〜C-52・C-54・C-55・C-77・C-57 -->

# フロントエンド

作業の過程と結果は、すべて日本語で書く。ルールの強さは、**MUST**（必ず守る）・**MUST NOT**（必ず避ける）・**SHOULD**（原則として守る。守らない場合は理由を{{pr_equivalent}}に書く）で表す。

## ディレクトリ構成

```text
src/
├─ pages/          ルーティング単位の画面（レイアウトと機能の組み合わせのみ）
├─ features/       機能単位の実装
├─ components/     全体で使う共通UI
├─ hooks/          共通Custom Hook
├─ services/       共通のAPI通信（Axiosのインスタンス）
├─ schemas/        共通のZodスキーマ
├─ types/          共通の型
├─ utils/          純粋関数
├─ constants/      共通の定数
└─ test/           テストの共通処理
```

- **MUST NOT**：`pages/`にAPI通信・状態管理・業務ロジックを書かない
- **MUST NOT**：`features/`から`pages/`を参照しない。依存の向きは「`pages/` → `features/` → 共通のもの」
- **SHOULD**：ほかの機能の内部を直接参照せず、各機能の公開部分（`index.ts`）を通す
- 1つの機能でしか使わないスキーマ・定数・Hookは、`features/<機能>/`に置く
- **MUST NOT**：汎用ロジックを`components/`に置かない

## 命名と整形

- 整形はPrettier等の自動整形ツールに任せ、書式を人やAIが判断しない
- Reactコンポーネントのファイルは`PascalCase.tsx`、Custom Hookは`useCamelCase.ts`、その他のファイルとディレクトリは`kebab-case`、テストは対象と同じ場所に`.test`を付ける
- 変数・関数は`camelCase`、型・コンポーネントは`PascalCase`、定数・環境変数は`UPPER_SNAKE_CASE`

## コンポーネントとProps

- **MUST**：1つのコンポーネントの主な責務を1つにする。分割するかは行数より責務で判断する
- **MUST NOT**：API通信・データ変換・入力チェック・描画を1つのファイルに集中させない
- **SHOULD**：表示と複雑な状態管理が混ざる場合は、状態管理をCustom Hookに分ける
- **MUST**：Propsの型を定義する。**SHOULD**：必要なデータだけを渡す

## 型

- **MUST**：`tsconfig`の`strict`を有効にする
- **MUST**：公開する関数・APIレスポンス・Propsに明示的な型を付ける
- **MUST NOT**：`any`を原則使わない。型エラーを回避するためだけに`as`を使わない
- **SHOULD**：型が分からない値は`unknown`で受け、型ガードまたはZodで絞り込む

## 状態管理・Hooks・useEffect

- **MUST**：コンポーネント固有のUIの状態は`useState`、サーバーから取得したデータはServer State（TanStack Query）で扱う
- **MUST NOT**：Server Stateをグローバルなストアへコピーして二重に管理しない
- **SHOULD**：複数の画面で共有するUIの状態に限り、Zustand等を検討する
- **MUST**：Hookの名前は`use`から始め、Hooksのルールを守る。**MUST NOT**：単純な1〜2行の処理を理由なくHookにしない
- **MUST NOT**：値を計算するだけの目的で`useEffect`を使わない。PropsやStateから導き出せる値を別のStateに持たない
- **SHOULD**：`useEffect`は外部システムとの同期に限る

## API通信（Axios）

- **MUST**：Axiosのインスタンスは`services/`で1つ作り、全体でそれを使う。コンポーネントやHookから`axios`・`fetch`を直接使わない
- **MUST**：接続先のURLは環境変数から読む
- 要求のインターセプター：リクエストIDの付与、認証・CSRF対策に必要なヘッダーの付与
- 応答のインターセプター：エラーを共通のエラーの形（HTTPステータス・エラーコード・利用者向けメッセージ）に変換、`401`の処理（更新は1回だけ、遷移を重複させない）、ログへの記録
- **MUST NOT**：インターセプターの中でエラーをもみ消さない。変換した後も、必ず失敗として呼び出し元へ返す
- **MUST NOT**：インターセプターに、特定の画面・機能だけの処理を書かない
- **MUST**：APIのレスポンスを型だけで信用しない。**SHOULD**：Zodで検証する

## 操作結果の即時反映

- **MUST**：操作でデータを変えたら、再読み込みしなくても、関係する表示すべて（一覧・詳細・件数・バッジ・ステータス表示・ほかの画面の同じデータ等）にすぐ反映する
- **MUST**：変更が成功したら、TanStack Queryの該当するデータを更新し直す（`invalidateQueries`または`setQueryData`）
- **MUST**：クエリキーは機能ごとに1か所（`features/<機能>/api/query-keys.ts`等）で定義して使い回す
- **MUST NOT**：同じデータを`useState`やグローバルなストアにコピーして持たない
- **SHOULD**：楽観的更新をする場合は、失敗したときに元に戻し、失敗を知らせる
- **MUST**：変更に失敗した場合は、表示を変えずにエラーを知らせる
- **MUST**：E2Eで、操作の後に再読み込みせずに表示が変わっていることを確かめる
- ほかの利用者の変更を自動で届ける仕組み（WebSocket等）が必要かは、要件で決める

## フォーム

- **MUST**：画面側で入力チェックを行う。サーバー側でもチェックすることを前提にする
- **SHOULD**：React Hook Form＋Zodを標準にする
- **MUST**：送信中は多重送信を防ぐ

## 画面の状態とエラー表示

- **MUST**：非同期でデータを扱う画面では、loading・success・empty・errorの4つを明示的に扱う
- **MUST NOT**：取得に失敗したのに、空の一覧（empty）として表示しない
- **MUST**：予期できるエラーと予期しないエラーを区別し、利用者向けの文とログを分ける
- **MUST NOT**：内部の例外・スタックトレース・機密情報を画面に表示しない
- **SHOULD**：React Error Boundaryを適切な単位で配置する

## セキュリティ

- **MUST NOT**：`dangerouslySetInnerHTML`を原則使わない
- **MUST NOT**：秘密鍵・API Secret・パスワードをフロントエンドのコードに含めない
- **MUST NOT**：認可をフロントエンドだけで保証しない。画面の表示の制御と、バックエンドでの認可は別物である
- **MUST**：URL・フォームの値・APIのレスポンスを外部からの入力として扱う
- ログイン画面のルールはSkill「セキュリティ」に従う

## パフォーマンス

- **MUST NOT**：根拠なく`useMemo`・`useCallback`・`memo`を使わない
- **MUST**：`key`には安定した一意のIDを使う。配列の添字を安易に使わない
- **SHOULD**：大量のリストは、ページング・仮想化を検討する
- 初回に読み込むJavaScriptは圧縮後200KB以下を目安にする（Skill「知見」の`frontend/initial-bundle-size`）

## アクセシビリティ

- **MUST**：ボタンには`button`要素、入力欄には`label`、画像には適切な`alt`を付ける
- **MUST**：キーボードだけで操作できるようにする。**SHOULD**：`aria`属性は必要な場合に限る

## アイコン

- アプリアイコン・ファビコンは必ず用意する。正式な画像がない場合は、仮の画像（アプリ名の頭文字等）が入っている。本番へ公開する前に、同じファイル名・サイズで差し替える

## フロントエンドの完了の定義

`AGENTS.md`の完了の定義に加えて、次を満たすまで完了としない。

- TypeScript・ESLintのエラーがなく、整形済みである
- loading・error・emptyの状態を考慮している
- アクセシビリティを確認している
- 不要な`console.log`・不要な依存関係が残っていない
