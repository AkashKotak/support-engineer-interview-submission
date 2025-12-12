import { describe, it, expect } from "vitest";
import { signupSchema, fundingSchema } from "../lib/validations";

describe("Validation Logic", () => {
    describe("Signup Schema (VAL-201, 202, 203, 204, 208)", () => {
        it("should reject users under 18 (VAL-202)", () => {
            const under18 = {
                ...validUser,
                dateOfBirth: new Date().toISOString(), // Today
            };
            const result = signupSchema.safeParse(under18);
            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.error.issues[0].message).toContain("at least 18");
            }
        });

        it("should require strong passwords (VAL-208)", () => {
            const weak = { ...validUser, password: "password" };
            const result = signupSchema.safeParse(weak);
            expect(result.success).toBe(false);
        });

        it("should validate email typos (VAL-201)", () => {
            const typo = { ...validUser, email: "test@example.con" };
            const result = signupSchema.safeParse(typo);
            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.error.issues[0].message).toContain(".com");
            }
        });

        it("should validate phone numbers (VAL-204)", () => {
            const badPhone = { ...validUser, phoneNumber: "123" };
            const result = signupSchema.safeParse(badPhone);
            expect(result.success).toBe(false);
        });

        it("should validate state codes (VAL-203)", () => {
            const badState = { ...validUser, state: "California" };
            const result = signupSchema.safeParse(badState);
            expect(result.success).toBe(false);
        });
    });

    describe("Funding Schema (VAL-205, 206, 207, 210)", () => {
        it("should reject zero amounts (VAL-205)", () => {
            const zero = { ...validFunding, amount: 0 };
            const result = fundingSchema.safeParse(zero);
            expect(result.success).toBe(false);
        });

        it("should require routing number for banks (VAL-207)", () => {
            const noRouting = {
                amount: 100,
                fundingSource: {
                    type: "bank",
                    accountNumber: "123",
                    // routingNumber missing
                }
            };
            const result = fundingSchema.safeParse(noRouting);
            expect(result.success).toBe(false);
        });

        it("should validate card numbers using Luhn (VAL-206)", () => {
            const invalidLuhn = {
                amount: 100,
                fundingSource: {
                    type: "card",
                    accountNumber: "4111111111111112", // Invalid
                }
            };
            const result = fundingSchema.safeParse(invalidLuhn);
            expect(result.success).toBe(false);
        });
    });
});

// Helpers
const validUser = {
    email: "test@example.com",
    password: "Password1!",
    firstName: "Test",
    lastName: "User",
    phoneNumber: "+15551234567",
    dateOfBirth: "1990-01-01",
    ssn: "123456789",
    address: "123 St",
    city: "City",
    state: "CA",
    zipCode: "12345",
};

const validFunding = {
    amount: 100,
    fundingSource: {
        type: "card",
        accountNumber: "4111111111111111", // Valid visa test card
    },
};
