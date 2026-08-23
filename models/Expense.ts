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
  },
  { timestamps: true }
);
ExpenseSchema.index({ userId: 1, dateKey: -1, createdAt: -1 });

export const Expense = models.Expense ?? model("Expense", ExpenseSchema);
