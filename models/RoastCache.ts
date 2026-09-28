import { Schema, model, models } from "mongoose";

// One AI-written roast per user per day and situation, so the app and notifications agree and API limits hold.
const RoastCacheSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    key: { type: String, required: true, maxlength: 80 },
    line: { type: String, required: true, maxlength: 240 },
    expiresAt: { type: Date, required: true, expires: 0 },
  },
  { timestamps: true }
);
RoastCacheSchema.index({ userId: 1, key: 1 }, { unique: true });

export const RoastCache = models.RoastCache ?? model("RoastCache", RoastCacheSchema);
