import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../trpc";
import { db } from "@/lib/db";
import { accounts, transactions } from "@/lib/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";

import { randomInt } from "crypto";

function generateAccountNumber(): string {
  return randomInt(1000000000, 9999999999).toString();
}

import { fundingSchema } from "@/lib/validations";

export const accountRouter = router({
  createAccount: protectedProcedure
    .input(
      z.object({
        accountType: z.enum(["checking", "savings"]),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Check if user already has an account of this type
      const existingAccount = await db
        .select()
        .from(accounts)
        .where(and(eq(accounts.userId, ctx.user.id), eq(accounts.accountType, input.accountType)))
        .get();

      if (existingAccount) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `You already have a ${input.accountType} account`,
        });
      }

      let accountNumber;
      let isUnique = false;

      // Generate unique account number
      while (!isUnique) {
        accountNumber = generateAccountNumber();
        const existing = await db.select().from(accounts).where(eq(accounts.accountNumber, accountNumber)).get();
        isUnique = !existing;
      }

      const [account] = await db
        .insert(accounts)
        .values({
          userId: ctx.user.id,
          accountNumber: accountNumber!,
          accountType: input.accountType,
          balance: 0,
          status: "active",
        })
        .returning();

      return account;
    }),

  getAccounts: protectedProcedure.query(async ({ ctx }) => {
    const userAccounts = await db.select().from(accounts).where(eq(accounts.userId, ctx.user.id));

    return userAccounts;
  }),

  fundAccount: protectedProcedure
    .input(
      z.object({
        accountId: z.number(),
      }).merge(fundingSchema)
    )
    .mutation(async ({ input, ctx }) => {
      const amount = parseFloat(input.amount.toString());

      // Verify account belongs to user
      const account = await db
        .select()
        .from(accounts)
        .where(and(eq(accounts.id, input.accountId), eq(accounts.userId, ctx.user.id)))
        .get();

      if (!account) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Account not found",
        });
      }

      if (account.status !== "active") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Account is not active",
        });
      }

      // Use a transaction to ensure both the transaction record and balance update happen atomically
      // better-sqlite3 transactions are synchronous
      return db.transaction((tx) => {
        // Create transaction record
        const [transaction] = tx
          .insert(transactions)
          .values({
            accountId: input.accountId,
            type: "deposit",
            amount,
            description: `Funding from ${input.fundingSource.type}`,
            status: "completed",
            processedAt: new Date().toISOString(),
          })
          .returning()
          .all();

        // Update account balance atomically (Fix Race Condition)
        const [updatedAccount] = tx
          .update(accounts)
          .set({
            balance: sql`${accounts.balance} + ${amount}`,
          })
          .where(eq(accounts.id, input.accountId))
          .returning()
          .all();

        return {
          transaction,
          newBalance: updatedAccount.balance,
        };
      });
    }),

  getTransactions: protectedProcedure
    .input(
      z.object({
        accountId: z.number(),
      })
    )
    .query(async ({ input, ctx }) => {
      // Verify account belongs to user
      const account = await db
        .select()
        .from(accounts)
        .where(and(eq(accounts.id, input.accountId), eq(accounts.userId, ctx.user.id)))
        .get();

      if (!account) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Account not found",
        });
      }

      const accountTransactions = await db
        .select()
        .from(transactions)
        .where(eq(transactions.accountId, input.accountId))
        .orderBy(desc(transactions.createdAt));

      // Fix N+1: Use the already fetched account details
      const enrichedTransactions = accountTransactions.map((transaction) => ({
        ...transaction,
        accountType: account.accountType,
      }));

      return enrichedTransactions;
    }),
});
