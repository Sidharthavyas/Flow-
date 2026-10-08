import { compare, hash } from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { destroyOtherSessions, requireApiUser } from "@/lib/auth";
import { dbConnect } from "@/lib/db";
import { isTrustedOrigin, jsonError } from "@/lib/http";
import { changePasswordSchema } from "@/lib/validators";
import { PasswordReset } from "@/models/PasswordReset";
import { User } from "@/models/User";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!isTrustedOrigin(request)) return jsonError("Invalid request origin", 403);
  try {
    const user = await requireApiUser();
    const parsed = changePasswordSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError(parsed.error.issues.find((i) => i.path[0] === "newPassword")?.message || "Please check your passwords");
    if (parsed.data.currentPassword === parsed.data.newPassword) return jsonError("Choose a password different from the current one");
    await dbConnect();
    const doc = await User.findById(user.id).select("+passwordHash");
    if (!doc || !(await compare(parsed.data.currentPassword, doc.passwordHash))) return jsonError("Current password isn't right", 403);
    doc.passwordHash = await hash(parsed.data.newPassword, 12);
    await doc.save();
    // Keep this device signed in; other phones and browsers must sign in again with the new password.
    const signedOut = await destroyOtherSessions(user.id);
    await PasswordReset.deleteMany({ userId: doc._id });
    return NextResponse.json({ ok: true, signedOut });
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHORIZED") return jsonError("Unauthorized", 401);
    throw e;
  }
}
