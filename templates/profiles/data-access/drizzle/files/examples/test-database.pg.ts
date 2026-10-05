// Skill の例のテスト（*.db.test.ts）が使う、検証用の PostgreSQL への接続。
// Skill の書き方の例なので、消さない。ハーネスが管理するファイルで、ハーネスの更新で置き換わる。
//
// 例のテストは、この接続だけの一時的な表（CREATE TEMP TABLE。接続を閉じると消える）を使う。
// マイグレーション・シード・既存の表には触れないため、開発・検証のデータは変わらない。
import { Client } from "pg";

/** 手元の検証用の PostgreSQL だけを許す（localhost。コンテナの中では、サービス名 db） */
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]", "db"];

/** つなぐ前に、接続先が手元で、DB の名前が _test で終わることを確かめる。値（パスワードなど）は表示しない */
export function assertTestDatabaseUrl(url: string | undefined): string {
  if (url === undefined || url === "") {
    throw new Error(
      "DATABASE_URL がありません（.env.test を用意し、npm run test:db で実行してください）",
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      "DATABASE_URL の形式が正しくありません（値は表示しません）",
    );
  }
  if (!LOCAL_HOSTS.includes(parsed.hostname)) {
    throw new Error("手元の検証用 PostgreSQL 以外には、つなぎません");
  }
  if (!/_test$/.test(parsed.pathname.slice(1))) {
    throw new Error(
      "検証用の DB（名前が _test で終わる）以外には、つなぎません",
    );
  }
  return url;
}

/** 検証用の PostgreSQL に1本つなぐ。つながらないときは、起動の方法を知らせて失敗する */
export async function connectTestDatabase(): Promise<Client> {
  const client = new Client({
    connectionString: assertTestDatabaseUrl(process.env["DATABASE_URL"]),
  });
  try {
    await client.connect();
  } catch (error) {
    // 3D000：その名前の DB がない。開発用のコンテナの db につないだときに起きる
    const missing = (error as { code?: unknown }).code === "3D000";
    throw new Error(
      missing
        ? "接続先に検証用の DB がありません。開発用のコンテナの中ではなく、検証用のコンテナ（npm run docker:up:test）の中か、手元で実行してください"
        : "検証用の PostgreSQL につなげません。検証用 DB を起動してください（npm run docker:up:test）",
      { cause: error },
    );
  }
  return client;
}
