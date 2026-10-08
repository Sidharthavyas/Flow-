import { Schema, model, models } from "mongoose";

// One-time password reset links. Only the SHA-256 of the token is stored; documents expire on their own.
const PasswordResetSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true, expires: 0 },
  },
  { timestamps: true }
);

export const PasswordReset = models.PasswordReset ?? model("PasswordReset", PasswordResetSchema);
