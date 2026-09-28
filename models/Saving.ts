import { Schema, model, models } from "mongoose";

const SavingSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    action: { type: String, enum: ["opening", "deposit", "transfer", "withdrawal"], required: true },
    amountPaise: { type: Number, required: true, min: 1 },
    dateKey: { type: String, required: true, index: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    fromAccount: { type: String, default: "", trim: true, maxlength: 100 },
    toAccount: { type: String, default: "", trim: true, maxlength: 100 },
    method: { type: String, default: "", trim: true, maxlength: 60 },
    note: { type: String, default: "", trim: true, maxlength: 500 },
  },
  { timestamps: true }
);

SavingSchema.index({ userId: 1, dateKey: -1, createdAt: -1 });

export const Saving = models.Saving ?? model("Saving", SavingSchema);
