import { describe, it, expect, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../lib/db/schema";
import { users, accounts, transactions, sessions } from "../lib/db/schema";
import { eq } from "drizzle-orm";

// Setup In-Memory DB
const sqlite = new Database(":memory:");
const db = drizzle(sqlite, { schema });

// Initialize Schema
sqlite.exec(`
  CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, password TEXT, first_name TEXT, last_name TEXT, phone_number TEXT, date_of_birth TEXT, ssn TEXT, address TEXT, city TEXT, state TEXT, zip_code TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE accounts (id INTEGER PRIMARY KEY, user_id INTEGER, account_number TEXT, account_type TEXT, balance REAL, status TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE transactions (id INTEGER PRIMARY KEY, account_id INTEGER, type TEXT, amount REAL, description TEXT, status TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, processed_at TEXT);
  CREATE TABLE sessions (id INTEGER PRIMARY KEY, user_id INTEGER, token TEXT, expires_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
`);

// Mock needs to be applied BEFORE importing routers
vi.doMock("@/lib/db", () => ({
    db: db,
}));

describe("Backend Integration Tests", () => {
    let authRouter: any;
    let accountRouter: any;

    beforeEach(async () => {
        // Clear tables
        sqlite.exec("DELETE FROM users; DELETE FROM accounts; DELETE FROM transactions; DELETE FROM sessions;");

        // Dynamically import routers so they use the mocked DB
        // We need to reset modules to ensure clean import if we were using isolated modules, 
        // but typically just waiting to import them here is enough if they weren't imported at top.
        const authModule = await import("../server/routers/auth");
        const accountModule = await import("../server/routers/account");
        authRouter = authModule.authRouter;
        accountRouter = accountModule.accountRouter;
    });

    const createCallerContext = (user?: any) => ({
        user,
        req: {} as any,
        res: { setHeader: vi.fn(), set: vi.fn() } as any,
    });

    describe("Transaction Sorting (PERF-404)", () => {
        it("should return transactions in descending order (newest first)", async () => {
            // 1. Setup User & Account
            const [user] = await db.insert(users).values({
                email: "sort@test.com", password: "hash", firstName: "Sort", lastName: "Test",
                phoneNumber: "123", dateOfBirth: "1990", ssn: "enc", address: "abc", city: "ny", state: "ny", zipCode: "10001"
            }).returning();
            const [account] = await db.insert(accounts).values({
                userId: user.id, accountNumber: "1001", accountType: "checking", balance: 100, status: "active"
            }).returning();

            // 2. Insert Transactions with different times
            await db.insert(transactions).values([
                { accountId: account.id, type: "deposit", amount: 10, status: "completed", createdAt: "2023-01-01T10:00:00Z" },
                { accountId: account.id, type: "deposit", amount: 20, status: "completed", createdAt: "2023-01-02T10:00:00Z" }, // Newest
                { accountId: account.id, type: "deposit", amount: 30, status: "completed", createdAt: "2023-01-01T09:00:00Z" }, // Oldest
            ]);

            // 3. Call getTransactions
            const caller = accountRouter.createCaller(createCallerContext(user));
            const result = await caller.getTransactions({ accountId: account.id });

            // 4. Verify Order
            expect(result).toHaveLength(3);
            expect(result[0].amount).toBe(20);
            expect(result[1].amount).toBe(10);
            expect(result[2].amount).toBe(30);
        });
    });

    describe("Rate Limiting (Security Enhancement)", () => {
        it("should block login after 5 failed attempts", async () => {
            const caller = authRouter.createCaller(createCallerContext());
            const email = "rate_limit@test.com";

            for (let i = 0; i < 5; i++) {
                await expect(caller.login({ email, password: "wrong_password" }))
                    .rejects.toThrow("Invalid credentials");
            }

            await expect(caller.login({ email, password: "wrong_password" }))
                .rejects.toThrow("Too many login attempts");
        });
    });

    describe("Race Condition Prevention (Atomic Updates)", () => {
        it("should correctly update balance using atomic logic", async () => {
            const [user] = await db.insert(users).values({
                email: "race@test.com", password: "hash", firstName: "Race", lastName: "Test",
                phoneNumber: "123", dateOfBirth: "1990", ssn: "enc", address: "abc", city: "ny", state: "ny", zipCode: "10001"
            }).returning();

            const [account] = await db.insert(accounts).values({
                userId: user.id, accountNumber: "2001", accountType: "checking", balance: 100, status: "active"
            }).returning();

            const caller = accountRouter.createCaller(createCallerContext(user));

            await caller.fundAccount({
                accountId: account.id,
                amount: 50,
                fundingSource: { type: "bank", accountNumber: "123", routingNumber: "123456789" }
            });

            const updatedAccount = await db.select().from(accounts).where(eq(accounts.id, account.id)).get();
            expect(updatedAccount!.balance).toBe(150);

            await caller.fundAccount({
                accountId: account.id,
                amount: 50,
                fundingSource: { type: "bank", accountNumber: "123", routingNumber: "123456789" }
            });

            const finalAccount = await db.select().from(accounts).where(eq(accounts.id, account.id)).get();
            expect(finalAccount!.balance).toBe(200);
        });
    });
});
