// 認証の表（PostgreSQL）。認証の方式（独自認証・OIDC・併用）に関係なく、同じ表を作る。使わない表は消してよい（SKILL を参照）。
// 外部キーはすべて users に向け、利用者を消すと関連する行も消える。
import {
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp as pgTimestamp,
} from "drizzle-orm/pg-core";

const timestamp = (name: string) =>
  pgTimestamp(name, { withTimezone: true, mode: "date" });

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  // 独自認証のときだけ入る（OIDC だけの利用者は null）
  passwordHash: text("password_hash"),
  createdAt: timestamp("created_at").notNull(),
});

// 外部 IdP のアカウントとの対応（issuer と subject の組が、1つの利用者に決まる）
export const userIdentities = pgTable(
  "user_identities",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    issuer: text("issuer").notNull(),
    subject: text("subject").notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.issuer, table.subject] })],
);

// セッション。識別子そのものは保存せず、ハッシュ（id_hash）だけを保存する
export const sessions = pgTable(
  "sessions",
  {
    idHash: text("id_hash").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull(),
    lastSeenAt: timestamp("last_seen_at").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

// パスワード再設定のトークン（ハッシュだけを保存する）
export const passwordResetTokens = pgTable("password_reset_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
});

// ログイン試行の回数（試行の制限）
export const loginAttempts = pgTable("login_attempts", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start").notNull(),
  count: integer("count").notNull(),
  lockedUntil: timestamp("locked_until"),
});

// OIDC のログインの途中の状態（state はハッシュだけを保存する）
export const oidcStates = pgTable("oidc_states", {
  stateHash: text("state_hash").primaryKey(),
  nonce: text("nonce").notNull(),
  codeVerifier: text("code_verifier").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
});
