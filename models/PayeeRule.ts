import { Schema, model, models } from "mongoose";

// What the user taught Flow about a payee from bank SMS: "Amit, small amounts → Food & Dining", or "this is me → transfer".
// One rule per payee and amount band, so the same shop can mean chai at ₹30 and groceries at ₹800.
const PayeeRuleSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    payeeKey: { type: String, required: true, maxlength: 60 },
    payee: { type: String, default: "", maxlength: 60 },
    band: { type: String, enum: ["small", "medium", "large"], required: true },
    kind: { type: String, enum: ["expense", "transfer"], required: true },
    category: { type: String, default: "", maxlength: 80 },
    uses: { type: Number, default: 1 },
  },
  { timestamps: true }
);
PayeeRuleSchema.index({ userId: 1, payeeKey: 1, band: 1 }, { unique: true });

export const PayeeRule = models.PayeeRule ?? model("PayeeRule", PayeeRuleSchema);
