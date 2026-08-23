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

export const budgetSchema = z.object({
  periodType: z.enum(["week", "month"]),
  periodStart: dateKey,
  amount: money,
});
