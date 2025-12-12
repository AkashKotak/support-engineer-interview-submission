import { z } from "zod";

export const signupSchema = z.object({
    email: z
        .string()
        .email("Invalid email format")
        .toLowerCase()
        .refine((val) => !val.includes(".con"), "Did you mean .com?"),
    password: z
        .string()
        .min(8)
        .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
        .regex(/[a-z]/, "Password must contain at least one lowercase letter")
        .regex(/[0-9]/, "Password must contain at least one number")
        .regex(/[\W_]/, "Password must contain at least one special character"),
    firstName: z.string().min(1, "First name is required"),
    lastName: z.string().min(1, "Last name is required"),
    phoneNumber: z.string().regex(/^\+?[1-9]\d{9,14}$/, "Invalid phone number format"),
    dateOfBirth: z.string().refine(
        (val) => {
            const date = new Date(val);
            if (isNaN(date.getTime())) return false;
            const today = new Date();
            const age = today.getFullYear() - date.getFullYear();
            const m = today.getMonth() - date.getMonth();
            const actualAge = m < 0 || (m === 0 && today.getDate() < date.getDate()) ? age - 1 : age;
            return actualAge >= 18;
        },
        { message: "You must be at least 18 years old" }
    ),
    ssn: z.string().regex(/^\d{9}$/, "SSN must be 9 digits"),
    address: z.string().min(1, "Address is required"),
    city: z.string().min(1, "City is required"),
    state: z
        .string()
        .length(2, "State code must be 2 characters")
        .toUpperCase()
        .refine((val) => /^[A-Z]{2}$/.test(val), "Invalid state code format"),
    zipCode: z.string().regex(/^\d{5}$/, "Zip code must be 5 digits"),
});

export const fundingSchema = z.object({
    amount: z.number().min(0.01, "Amount must be at least $0.01"),
    fundingSource: z.object({
        type: z.enum(["card", "bank"]),
        accountNumber: z.string(),
        routingNumber: z.string().optional(),
    }).superRefine((data, ctx) => {
        if (data.type === "bank" && !data.routingNumber) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Routing number is required for bank transfers",
                path: ["routingNumber"],
            });
        }
        if (data.type === "card") {
            // Luhn Algorithm
            const sanitized = data.accountNumber.replace(/\D/g, "");
            let sum = 0;
            let shouldDouble = false;
            for (let i = sanitized.length - 1; i >= 0; i--) {
                let digit = parseInt(sanitized.charAt(i));
                if (shouldDouble) {
                    digit *= 2;
                    if (digit > 9) digit -= 9;
                }
                sum += digit;
                shouldDouble = !shouldDouble;
            }
            if (sum % 10 !== 0) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: "Invalid card number",
                    path: ["accountNumber"],
                });
            }
        }
    }),
});
