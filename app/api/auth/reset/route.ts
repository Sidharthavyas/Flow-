import { hash } from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { createSession, hashToken } from "@/lib/auth";
import { dbConnect } from "@/lib/db";
import { isTrustedOrigin, jsonError } from "@/lib/http";
import { resetPasswordSchema } from "@/lib/validators";
import { PasswordReset } from "@/models/PasswordReset";
import { Session } from "@/models/Session";
import { User } from "@/models/User";

export const runtime = "nodejs";

const EXPIRED = "This reset link has expired or was already used. Request a new one.";

export async function POST(request: NextRequest) {
  if (!isTrustedOrigin(request)) return jsonError("Invalid request origin", 403);
  const parsed = resetPasswordSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const passwordIssue = parsed.error.issues.find((issue) => issue.path[0] === "password");
    return jsonError(passwordIssue ? "Password must be at least 8 characters" : EXPIRED);
  }
  await dbConnect();
  // Claim the link atomically so it can only ever be used once.
  const reset = await PasswordReset.findOneAndDelete({ tokenHash: hashToken(parsed.data.token), expiresAt: { $gt: new Date() } }).lean();
  if (!reset) return jsonError(EXPIRED, 410);
  const user = await User.findByIdAndUpdate(reset.userId, { passwordHash: await hash(parsed.data.password, 12) }).select("_id").lean();
  if (!user) return jsonError(EXPIRED, 410);
  // The old password may be known to someone else: end every session and every other reset link.
  await Promise.all([Session.deleteMany({ userId: user._id }), PasswordReset.deleteMany({ userId: user._id })]);
  await createSession(String(user._id));
  return NextResponse.json({ ok: true });
}
