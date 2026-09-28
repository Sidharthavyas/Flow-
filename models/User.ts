import { Schema, model, models, type InferSchemaType } from "mongoose";

const UserSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    passwordHash: { type: String, required: true, select: false },
    moneyMode: { type: String, enum: ["savings", "investments"], default: undefined },
    customExpenseCategories: {
      type: [{ type: String, trim: true, maxlength: 80 }],
      default: [],
      validate: { validator: (items: string[]) => items.length <= 40, message: "Too many custom categories" },
    },
  },
  { timestamps: true }
);

export type UserDoc = InferSchemaType<typeof UserSchema>;
export const User = models.User ?? model("User", UserSchema);
