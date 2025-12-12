import { z } from "zod";
import { encrypt } from "@/lib/crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { TRPCError } from "@trpc/server";
import { publicProcedure, router } from "../trpc";
import { db } from "@/lib/db";
import { users, sessions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

import { signupSchema } from "@/lib/validations";

const loginAttempts = new Map<string, { count: number; expires: number }>();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_ATTEMPTS = 5;

export const authRouter = router({
  signup: publicProcedure
    .input(signupSchema)
    .mutation(async ({ input, ctx }) => {
      const existingUser = await db.select().from(users).where(eq(users.email, input.email)).get();

      if (existingUser) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "User already exists",
        });
      }

      const hashedPassword = await bcrypt.hash(input.password, 10);
      const encryptedSsn = encrypt(input.ssn);

      await db.insert(users).values({
        ...input,
        password: hashedPassword,
        ssn: encryptedSsn,
      });

      // Fetch the created user
      const user = await db.select().from(users).where(eq(users.email, input.email)).get();

      if (!user) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create user",
        });
      }

      // Create session
      const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET || "temporary-secret-for-interview", {
        expiresIn: "7d",
      });

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      await db.insert(sessions).values({
        userId: user.id,
        token,
        expiresAt: expiresAt.toISOString(),
      });

      // Set cookie
      if ("setHeader" in ctx.res) {
        ctx.res.setHeader("Set-Cookie", `session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800`);
      } else {
        (ctx.res as Headers).set("Set-Cookie", `session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800`);
      }

      return { user: { ...user, password: undefined }, token };
    }),

  login: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Rate Limiting
      const now = Date.now();
      const attempts = loginAttempts.get(input.email);

      if (attempts) {
        if (now > attempts.expires) {
          loginAttempts.delete(input.email);
        } else if (attempts.count >= MAX_ATTEMPTS) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: "Too many login attempts. Please try again later.",
          });
        }
      }

      const user = await db.select().from(users).where(eq(users.email, input.email)).get();

      if (!user) {
        // Record failed attempt
        const current = loginAttempts.get(input.email) || { count: 0, expires: now + RATE_LIMIT_WINDOW };
        loginAttempts.set(input.email, { count: current.count + 1, expires: current.expires });

        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Invalid credentials",
        });
      }

      const validPassword = await bcrypt.compare(input.password, user.password);

      if (!validPassword) {
        // Record failed attempt
        const current = loginAttempts.get(input.email) || { count: 0, expires: now + RATE_LIMIT_WINDOW };
        loginAttempts.set(input.email, { count: current.count + 1, expires: current.expires });

        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Invalid credentials",
        });
      }

      // Clear rate limit on success
      loginAttempts.delete(input.email);

      // SEC-304: Invalidate existing sessions (Simple implementation: remove all prior sessions for user)
      // This enforces single simultaneous session.
      await db.delete(sessions).where(eq(sessions.userId, user.id));

      const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET || "temporary-secret-for-interview", {
        expiresIn: "7d",
      });

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      await db.insert(sessions).values({
        userId: user.id,
        token,
        expiresAt: expiresAt.toISOString(),
      });

      if ("setHeader" in ctx.res) {
        ctx.res.setHeader("Set-Cookie", `session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800`);
      } else {
        (ctx.res as Headers).set("Set-Cookie", `session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800`);
      }

      return { user: { ...user, password: undefined }, token };
    }),

  logout: publicProcedure.mutation(async ({ ctx }) => {
    if (ctx.user) {
      // Delete session from database
      let token: string | undefined;
      if ("cookies" in ctx.req) {
        token = (ctx.req as any).cookies.session;
      } else {
        const cookieHeader = ctx.req.headers.get?.("cookie") || (ctx.req.headers as any).cookie;
        token = cookieHeader
          ?.split("; ")
          .find((c: string) => c.startsWith("session="))
          ?.split("=")[1];
      }
      if (token) {
        await db.delete(sessions).where(eq(sessions.token, token));
      }
    }

    // PERF-402: Ensure accurate logout
    const cookieOptions = "Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT";

    if ("setHeader" in ctx.res) {
      ctx.res.setHeader("Set-Cookie", `session=; ${cookieOptions}`);
    } else {
      (ctx.res as Headers).set("Set-Cookie", `session=; ${cookieOptions}`);
    }

    return { success: true, message: ctx.user ? "Logged out successfully" : "No active session" };
  }),
});
