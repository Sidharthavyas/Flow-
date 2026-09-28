import { z } from "zod";

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.number().finite().positive().max(100_000_000);

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.email().trim().toLowerCase().max(254),
  password: z.string().min(8).max(128),
});

export const loginSchema = z.object({
  email: z.email().trim().toLowerCase().max(254),
  password: z.string().min(1).max(128),
});

export const expenseSchema = z.object({
  amount: money,
  category: z.string().trim().min(1).max(80),
  date: dateKey,
  name: z.string().trim().max(120).default(""),
  payment: z.string().trim().max(60).default(""),
  type: z.string().trim().max(60).default(""),
  recurring: z.string().trim().max(30).default(""),
  extra: z.string().trim().max(500).default(""),
});

export const investmentSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.string().trim().min(1).max(60),
  invested: money,
  current: money,
  date: dateKey,
  frequency: z.string().trim().max(40).default(""),
  rate: z.union([z.number().finite().min(-100).max(10_000), z.null()]).default(null),
  platform: z.string().trim().max(100).default(""),
  maturity: z.union([dateKey, z.literal("")]).default(""),
  note: z.string().trim().max(500).default(""),
});

export const savingSchema = z.object({
  action: z.enum(["opening", "deposit", "transfer", "withdrawal"]),
  amount: money,
  date: dateKey,
  fromAccount: z.string().trim().max(100).default(""),
  toAccount: z.string().trim().max(100).default(""),
  method: z.string().trim().max(60).default(""),
  note: z.string().trim().max(500).default(""),
}).superRefine((data, ctx) => {
  if ((data.action === "opening" || data.action === "deposit") && !data.toAccount) {
    ctx.addIssue({ code: "custom", path: ["toAccount"], message: "Choose where the money is saved" });
  }
  if (data.action === "withdrawal" && !data.fromAccount) {
    ctx.addIssue({ code: "custom", path: ["fromAccount"], message: "Choose the account the money came from" });
  }
  if (data.action === "transfer") {
    if (!data.fromAccount || !data.toAccount) ctx.addIssue({ code: "custom", path: ["toAccount"], message: "Choose both transfer accounts" });
    if (data.fromAccount && data.toAccount && data.fromAccount.toLocaleLowerCase() === data.toAccount.toLocaleLowerCase()) {
      ctx.addIssue({ code: "custom", path: ["toAccount"], message: "Transfer accounts must be different" });
    }
  }
});

export const preferencesSchema = z.object({
  moneyMode: z.enum(["savings", "investments"]).optional(),
  customExpenseCategories: z.array(z.string().trim().min(1).max(80)).max(40).optional(),
}).refine((data) => data.moneyMode !== undefined || data.customExpenseCategories !== undefined, { message: "No preference changes supplied" });

export const budgetSchema = z.object({
  periodType: z.enum(["week", "month"]),
  periodStart: dateKey,
  amount: money,
});
