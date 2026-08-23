import { Schema, model, models } from "mongoose";

const BudgetSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    periodType: { type: String, enum: ["week", "month"], required: true },
    periodStart: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    amountPaise: { type: Number, required: true, min: 1 },
  },
  { timestamps: true }
);
BudgetSchema.index({ userId: 1, periodType: 1, periodStart: 1 }, { unique: true });

export const Budget = models.Budget ?? model("Budget", BudgetSchema);
