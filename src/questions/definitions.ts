import { validateAppName } from "./app-name.js";

/** 他の質問の回答への条件 */
export interface Condition {
  id: string;
  equals?: string;
  in?: string[];
  notEquals?: string;
}

export interface QuestionOption {
  value: string;
  label: string;
}

export interface QuestionDefinition {
  id: string;
  title: string;
  kind: "text" | "select" | "multiselect";
  options?: QuestionOption[];
  /** この条件のときだけ聞く（なければ常に聞く） */
  when?: Condition;
  /** この条件のとき、聞かずに value で決める */
  forced?: { when: Condition; value: string };
  /** 初期値（推奨） */
  initialValue?: string;
  /** false のとき、対話で聞かない（回答がなければ defaultValue を使う。なければ回答に入れない） */
  interactive?: boolean;
  /** 聞かない質問の、回答がないときの値 */
  defaultValue?: string;
  placeholder?: string;
  validate?: (value: string) => string | undefined;
}

/** 条件に合うか。条件の対象の回答がまだない場合は合わない（判断できない）として扱う */
export function matchesCondition(
  cond: Condition,
  answers: Readonly<Record<string, unknown>>,
): boolean {
  const value = answers[cond.id];
  if (typeof value !== "string") return false;
  if (cond.equals !== undefined) return value === cond.equals;
  if (cond.in !== undefined) return cond.in.includes(value);
  if (cond.notEquals !== undefined) return value !== cond.notEquals;
  return false;
}

const opts = (...pairs: [string, string][]): QuestionOption[] =>
  pairs.map(([value, label]) => ({ value, label }));

const yesNoUndecided = opts(["no", "なし"], ["yes", "あり"], ["undecided", "未定"]);

/** 質問の定義（データ）。質問の追加は、ここに足すだけで済む。順番は functional.md の「対話の質問順」 */
export const questionDefinitions: readonly QuestionDefinition[] = [
  {
    id: "app_name",
    title: "アプリ名",
    kind: "text",
    placeholder: "例：my-app（英小文字・数字・ハイフン）",
    validate: validateAppName,
  },
  {
    id: "ais",
    title: "使用するAI",
    kind: "multiselect",
    options: opts(["claude", "Claude Codeを使う"], ["codex", "Codexを使う"]),
  },
  {
    id: "project_type",
    title: "プロジェクトの種類",
    kind: "select",
    options: opts(["web", "Webアプリ"]),
  },
  {
    id: "layers",
    title: "フロントエンド・バックエンドの有無",
    kind: "select",
    options: opts(["frontend_backend", "両方あり"]),
  },
  {
    id: "repository",
    title: "リポジトリの置き場所",
    kind: "select",
    options: opts(["github", "GitHubを使う"], ["local", "使わない（手元のGitだけ）"]),
    initialValue: "github",
  },
  {
    id: "visibility",
    title: "リポジトリの公開範囲",
    kind: "select",
    options: opts(["public", "公開"], ["private", "非公開"]),
    forced: { when: { id: "repository", equals: "local" }, value: "private" },
  },
  {
    id: "team_size",
    title: "開発人数",
    kind: "select",
    options: opts(["solo", "1人"], ["team", "複数人"]),
  },
  {
    id: "frontend",
    title: "フロントエンドの技術",
    kind: "select",
    options: opts(["react", "React（TypeScriptで開発）"]),
  },
  {
    id: "backend",
    title: "バックエンドの技術",
    kind: "select",
    options: opts(["hono", "Hono（TypeScriptで開発）"]),
  },
  {
    id: "infra",
    title: "インフラ・デプロイ先",
    kind: "select",
    options: opts(["cloudflare", "Cloudflare（本番。開発・検証は手元で環境変数を切り替える）"]),
  },
  {
    id: "database",
    title: "データベース（DB）",
    kind: "select",
    options: opts(
      ["d1", "Cloudflare D1（標準）"],
      ["postgresql", "PostgreSQL（Hyperdrive経由）"],
      ["none", "なし"],
    ),
  },
  {
    id: "postgres_provider",
    title: "PostgreSQLの提供元",
    kind: "select",
    options: opts(
      ["neon", "Neon（サーバーレス型）"],
      ["supabase", "Supabase（BaaS型）"],
      ["other", "その他"],
    ),
    when: { id: "database", equals: "postgresql" },
  },
  {
    id: "data_access",
    title: "データアクセスのライブラリ",
    kind: "select",
    options: opts(["drizzle", "Drizzle ORM（標準）"]),
    when: { id: "database", notEquals: "none" },
  },
  {
    id: "auth",
    title: "認証方式",
    // 認証は機能要件に付随するため、生成のときに聞かず、要件定義で決める（#79）。--answers に書けばその値を使う
    interactive: false,
    defaultValue: "undecided",
    kind: "select",
    options: opts(
      ["none", "なし"],
      ["app", "アプリ独自認証"],
      ["oidc", "OIDC（推奨）"],
      ["both", "両方の併用"],
      ["undecided", "未定"],
    ),
  },
  {
    id: "idp",
    title: "外部IdP",
    interactive: false,
    kind: "select",
    options: opts(
      ["google", "Googleアカウント"],
      ["microsoft", "Microsoftアカウント"],
      ["other", "その他"],
    ),
    when: { id: "auth", in: ["oidc", "both"] },
  },
  {
    id: "personal_data",
    title: "個人情報の扱い",
    interactive: false,
    defaultValue: "undecided",
    kind: "select",
    options: opts(
      ["none", "扱わない"],
      ["basic", "基本的な情報（氏名・連絡先など）"],
      ["sensitive", "機微な情報（健康・信用など）"],
      ["undecided", "未定"],
    ),
  },
  {
    id: "admin",
    title: "管理者機能",
    interactive: false,
    defaultValue: "undecided",
    kind: "select",
    options: yesNoUndecided,
    forced: { when: { id: "auth", equals: "none" }, value: "no" },
  },
  {
    id: "critical_ops",
    title: "重要な操作（決済・公開範囲を広げる・削除・権限の変更など）",
    interactive: false,
    defaultValue: "undecided",
    kind: "select",
    options: yesNoUndecided,
  },
  {
    id: "critical_ops_kinds",
    title: "重要な操作の種類",
    interactive: false,
    kind: "multiselect",
    options: opts(
      ["payment", "決済"],
      [
        "publish",
        "公開範囲を広げる（資料・記事・ファイル等を、ほかの部署・社外・誰でも見られるようにする）",
      ],
      ["delete", "削除"],
      ["permission", "権限の変更"],
    ),
    when: { id: "critical_ops", equals: "yes" },
  },
  {
    id: "collaborative",
    title: "複数人での共同作業（同時編集・共有）",
    interactive: false,
    defaultValue: "undecided",
    kind: "select",
    options: yesNoUndecided,
    forced: { when: { id: "auth", equals: "none" }, value: "no" },
  },
  {
    id: "org_separation",
    title: "組織ごとのデータ分離",
    interactive: false,
    defaultValue: "undecided",
    kind: "select",
    options: yesNoUndecided,
  },
  {
    id: "realtime",
    title: "リアルタイムの更新",
    interactive: false,
    defaultValue: "undecided",
    kind: "select",
    options: yesNoUndecided,
  },
  {
    id: "availability",
    title: "止まったときの影響",
    interactive: false,
    defaultValue: "undecided",
    kind: "select",
    options: opts(
      ["tolerant", "止まっても許容できる"],
      ["critical", "止まると困る"],
      ["undecided", "未定"],
    ),
  },
  {
    id: "file_upload",
    title: "ファイルのアップロード",
    // 認証と同じく、要件定義で決める（#79）
    interactive: false,
    defaultValue: "undecided",
    kind: "select",
    options: opts(["no", "使わない"], ["yes", "使う"], ["undecided", "未定"]),
  },
  {
    id: "file_kinds",
    title: "扱うファイルの種類",
    interactive: false,
    kind: "multiselect",
    options: opts(["image", "画像"], ["video", "動画"], ["document", "その他の文書"]),
    when: { id: "file_upload", equals: "yes" },
  },
  {
    id: "check_location",
    title: "品質チェックの実行場所",
    kind: "select",
    options: opts(
      ["local", "ローカルのみ"],
      ["github_actions", "GitHub Actionsのみ"],
      ["both", "両方"],
    ),
    forced: { when: { id: "repository", equals: "local" }, value: "local" },
  },
  {
    id: "version_policy",
    title: "バージョンの方針",
    kind: "select",
    options: opts(["verified", "検証済みのバージョン"], ["latest", "最新の安定版"]),
  },
];

/** 回答の値が、定義に合っているかを確かめる（対話と --answers で同じ確かめを使う）。問題がなければ undefined */
export function validateValue(def: QuestionDefinition, value: unknown): string | undefined {
  const allowed = (def.options ?? []).map((o) => o.value);
  const choices = `選べる値：${allowed.join("・")}`;
  if (def.kind === "text") {
    return typeof value === "string" ? undefined : "文字列で指定してください";
  }
  if (def.kind === "select") {
    if (typeof value !== "string") return `文字列で指定してください（${choices}）`;
    return allowed.includes(value) ? undefined : `選択肢にない値です：${value}（${choices}）`;
  }
  if (!Array.isArray(value)) return `一覧（配列）で指定してください（${choices}）`;
  if (value.length === 0) return `1つ以上を指定してください（${choices}）`;
  for (const item of value) {
    if (typeof item !== "string") return `一覧の中身は文字列で指定してください（${choices}）`;
    if (!allowed.includes(item)) return `選択肢にない値です：${item}（${choices}）`;
  }
  return undefined;
}
