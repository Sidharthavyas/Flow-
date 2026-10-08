import { Schema, model, models } from "mongoose";

const ExpenseSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    amountPaise: { type: Number, required: true, min: 1 },
    category: { type: String, required: true, trim: true, maxlength: 80 },
    dateKey: { type: String, required: true, index: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    name: { type: String, default: "", trim: true, maxlength: 120 },
    payment: { type: String, default: "", trim: true, maxlength: 60 },
    type: { type: String, default: "", trim: true, maxlength: 60 },
    recurring: { type: String, default: "", trim: true, maxlength: 30 },
    extra: { type: String, default: "", trim: true, maxlength: 500 },
    // Added automatically from a bank SMS (Android app). smsRef (UPI/bank reference) stops the same payment twice.
    source: { type: String, enum: ["manual", "sms"], default: "manual" },
    smsRef: { type: String, default: undefined, maxlength: 80 },
    payee: { type: String, default: "", maxlength: 60 },
    account: { type: String, default: "", maxlength: 40 },
    needsReview: { type: Boolean, default: false },
  },
  { timestamps: true }
);
ExpenseSchema.index({ userId: 1, dateKey: -1, createdAt: -1 });
ExpenseSchema.index({ userId: 1, smsRef: 1 }, { unique: true, partialFilterExpression: { smsRef: { $type: "string" } } });
ExpenseSchema.index({ userId: 1, needsReview: 1 }, { partialFilterExpression: { needsReview: true } });

export const Expense = models.Expense ?? model("Expense", ExpenseSchema);
