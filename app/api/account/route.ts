import { compare } from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { destroySession, requireApiUser } from "@/lib/auth";
import { dbConnect } from "@/lib/db";
import { isTrustedOrigin, jsonError } from "@/lib/http";
import { deleteAccountSchema, profileSchema } from "@/lib/validators";
import { Budget } from "@/models/Budget";
import { Expense } from "@/models/Expense";
import { Investment } from "@/models/Investment";
import { PasswordReset } from "@/models/PasswordReset";
import { PayeeRule } from "@/models/PayeeRule";
import { RoastCache } from "@/models/RoastCache";
import { Saving } from "@/models/Saving";
import { Session } from "@/models/Session";
import { User } from "@/models/User";

export const runtime = "nodejs";

export async function PATCH(request: NextRequest) {
  if (!isTrustedOrigin(request)) return jsonError("Invalid request origin", 403);
  try {
    const user = await requireApiUser();
    const parsed = profileSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError(parsed.error.issues[0]?.message || "Please check your details");
    const update: Record<string, string> = {};
    if (parsed.data.name !== undefined) update.name = parsed.data.name;
    if (parsed.data.nickname !== undefined) update.nickname = parsed.data.nickname;
    await dbConnect();
    const doc = await User.findByIdAndUpdate(user.id, update, { new: true, runValidators: true }).select("name email nickname").lean();
    if (!doc) return jsonError("Unauthorized", 401);
    return NextResponse.json({ user: { id: String(doc._id), name: String(doc.name), email: String(doc.email), nickname: String(doc.nickname ?? "") } });
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHORIZED") return jsonError("Unauthorized", 401);
    throw e;
  }
}

// Permanently deletes the account and every record that belongs to it. Requires the current password.
export async function DELETE(request: NextRequest) {
  if (!isTrustedOrigin(request)) return jsonError("Invalid request origin", 403);
  try {
    const user = await requireApiUser();
    const parsed = deleteAccountSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("Enter your password to confirm");
    await dbConnect();
    const doc = await User.findById(user.id).select("+passwordHash");
    if (!doc || !(await compare(parsed.data.password, doc.passwordHash))) return jsonError("That password isn't right", 403);
    const userId = doc._id;
    await Promise.all([Expense, Investment, Saving, Budget, RoastCache, PasswordReset, PayeeRule].map((m) => m.deleteMany({ userId })));
    await destroySession();
    await Promise.all([Session.deleteMany({ userId }), User.deleteOne({ _id: userId })]);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHORIZED") return jsonError("Unauthorized", 401);
    throw e;
  }
}
