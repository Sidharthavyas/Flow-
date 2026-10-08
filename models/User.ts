import { Schema, model, models, type InferSchemaType } from "mongoose";

const UserSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    passwordHash: { type: String, required: true, select: false },
    moneyMode: { type: String, enum: ["savings", "investments"], default: undefined },
    // Legacy Bhai / Behen / Yaar picker; no longer read, kept so older documents still validate.
    roastAddress: { type: String, enum: ["yaar", "bhai", "behen"], default: undefined },
    nickname: { type: String, trim: true, maxlength: 30, default: "" },
    roastsEnabled: { type: Boolean, default: true },
    customExpenseCategories: {
      type: [{ type: String, trim: true, maxlength: 80 }],
      default: [],
      validate: { validator: (items: string[]) => items.length <= 40, message: "Too many custom categories" },
    },
    // Self-service password recovery without email: bcrypt hash of a one-time code the user saved.
    recoveryCodeHash: { type: String, select: false, default: undefined },
    recoveryCodeCreatedAt: { type: Date, default: undefined },
    recoveryFailures: { type: Number, default: 0, select: false },
    recoveryLockedUntil: { type: Date, default: undefined, select: false },
    // Bank accounts/cards seen in SMS ("BOI ••0457"); switching one off stops auto-adding from it.
    smsAccounts: {
      type: [{ label: { type: String, maxlength: 40 }, enabled: { type: Boolean, default: true }, lastSeenAt: Date, _id: false }],
      default: [],
    },
  },
  { timestamps: true }
);

export type UserDoc = InferSchemaType<typeof UserSchema>;
export const User = models.User ?? model("User", UserSchema);
