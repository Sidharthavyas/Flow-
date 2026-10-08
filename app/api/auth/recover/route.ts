import { compare, hash } from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { createSession } from "@/lib/auth";
import { dbConnect } from "@/lib/db";
import { isTrustedOrigin, jsonError } from "@/lib/http";
import { MAX_RECOVERY_FAILURES, RECOVERY_LOCK_MINUTES, newRecoveryCode, normalizeRecoveryCode } from "@/lib/recovery";
import { recoverWithCodeSchema } from "@/lib/validators";
import { PasswordReset } from "@/models/PasswordReset";
import { Session } from "@/models/Session";
import { User } from "@/models/User";

export const runtime = "nodejs";

const WRONG = "That email and recovery code don't match";
// Compared against when the email has no account/code, so both cases take about as long.
let dummyHash: Promise<string> | null = null;

// Forgot password without email: email + saved recovery code + new password. The used code is replaced with a new one.
export async function POST(request: NextRequest) {
  if (!isTrustedOrigin(request)) return jsonError("Invalid request origin", 403);
  const parsed = recoverWithCodeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const passwordIssue = parsed.error.issues.find((issue) => issue.path[0] === "password");
    return jsonError(passwordIssue ? "Password must be at least 8 characters" : "Enter your email and recovery code");
  }
  await dbConnect();
  const user = await User.findOne({ email: parsed.data.email }).select("+recoveryCodeHash +recoveryFailures +recoveryLockedUntil");
  if (user?.recoveryLockedUntil && user.recoveryLockedUntil > new Date()) {
    return jsonError(`Too many wrong attempts. Try again in ${RECOVERY_LOCK_MINUTES} minutes.`, 429);
  }
  const valid = await compare(normalizeRecoveryCode(parsed.data.code), user?.recoveryCodeHash || await (dummyHash ??= hash("no-code-on-file", 10)));
  if (!user || !user.recoveryCodeHash || !valid) {
    if (user) {
      const failures = (user.recoveryFailures ?? 0) + 1;
      await User.updateOne({ _id: user._id }, failures >= MAX_RECOVERY_FAILURES
        ? { recoveryFailures: 0, recoveryLockedUntil: new Date(Date.now() + RECOVERY_LOCK_MINUTES * 60_000) }
        : { recoveryFailures: failures });
    }
    return jsonError(WRONG, 400);
  }

  const next = await newRecoveryCode();
  await User.updateOne({ _id: user._id }, { passwordHash: await hash(parsed.data.password, 12), ...next.fields });
  await Promise.all([Session.deleteMany({ userId: user._id }), PasswordReset.deleteMany({ userId: user._id })]);
  await createSession(String(user._id));
  return NextResponse.json({ ok: true, recoveryCode: next.code });
}
