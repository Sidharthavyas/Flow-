import { Schema, model, models } from "mongoose";

const InvestmentSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    type: { type: String, required: true, trim: true, maxlength: 60 },
    investedPaise: { type: Number, required: true, min: 1 },
    currentPaise: { type: Number, required: true, min: 1 },
    dateKey: { type: String, required: true, index: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    frequency: { type: String, default: "", trim: true, maxlength: 40 },
    rate: { type: Number, default: null },
    platform: { type: String, default: "", trim: true, maxlength: 100 },
    maturityKey: { type: String, default: "", validate: { validator: (v: string) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v), message: "Invalid maturity date" } },
    note: { type: String, default: "", trim: true, maxlength: 500 },
  },
  { timestamps: true }
);
InvestmentSchema.index({ userId: 1, dateKey: -1, createdAt: -1 });

export const Investment = models.Investment ?? model("Investment", InvestmentSchema);
