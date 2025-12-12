import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

import { index } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").unique().notNull(),
  password: text("password").notNull(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  phoneNumber: text("phone_number").notNull(),
  dateOfBirth: text("date_of_birth").notNull(),
  ssn: text("ssn").notNull(),
  address: text("address").notNull(),
  city: text("city").notNull(),
  state: text("state").notNull(),
  zipCode: text("zip_code").notNull(),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
});

export const accounts = sqliteTable(
  "accounts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .references(() => users.id)
      .notNull(),
    accountNumber: text("account_number").unique().notNull(),
    accountType: text("account_type").notNull(), // checking, savings
    balance: real("balance").default(0).notNull(),
    status: text("status").default("pending"),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    userIdIdx: index("accounts_user_id_idx").on(table.userId),
    accountNumberIdx: index("accounts_account_number_idx").on(table.accountNumber),
  })
);

export const transactions = sqliteTable(
  "transactions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    accountId: integer("account_id")
      .references(() => accounts.id)
      .notNull(),
    type: text("type").notNull(), // deposit, withdrawal
    amount: real("amount").notNull(),
    description: text("description"),
    status: text("status").default("pending").notNull(),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
    processedAt: text("processed_at"),
  },
  (table) => ({
    accountIdIdx: index("transactions_account_id_idx").on(table.accountId),
    createdAtIdx: index("transactions_created_at_idx").on(table.createdAt),
  })
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .references(() => users.id)
      .notNull(),
    token: text("token").unique().notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    userIdIdx: index("sessions_user_id_idx").on(table.userId),
    tokenIdx: index("sessions_token_idx").on(table.token),
  })
);
