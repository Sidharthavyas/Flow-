import { compare } from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { dbConnect } from "@/lib/db";
import { isTrustedOrigin, jsonError } from "@/lib/http";
import { newRecoveryCode } from "@/lib/recovery";
import { createRecoveryCodeSchema } from "@/lib/validators";
import { User } from "@/models/User";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireApiUser();
    await dbConnect();
    const doc = await User.findById(user.id).select("recoveryCodeCreatedAt").lean();
    const createdAt = doc?.recoveryCodeCreatedAt ? new Date(doc.recoveryCodeCreatedAt).toISOString() : null;
    return NextResponse.json({ hasCode: Boolean(createdAt), createdAt }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHORIZED") return jsonError("Unauthorized", 401);
    throw e;
  }
}

// Creates (or replaces) the recovery code. Needs the password, so someone holding an unlocked phone can't use it to take over.
export async function POST(request: NextRequest) {
  if (!isTrustedOrigin(request)) return jsonError("Invalid request origin", 403);
  try {
    const user = await requireApiUser();
    const parsed = createRecoveryCodeSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("Enter your password to continue");
    await dbConnect();
    const doc = await User.findById(user.id).select("+passwordHash");
    if (!doc || !(await compare(parsed.data.password, doc.passwordHash))) return jsonError("That password isn't right", 403);
    const next = await newRecoveryCode();
    await User.updateOne({ _id: doc._id }, next.fields);
    return NextResponse.json({ recoveryCode: next.code, createdAt: next.fields.recoveryCodeCreatedAt.toISOString() }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHORIZED") return jsonError("Unauthorized", 401);
    throw e;
  }
}
