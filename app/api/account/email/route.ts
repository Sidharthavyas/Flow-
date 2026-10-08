import { compare } from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { dbConnect } from "@/lib/db";
import { isTrustedOrigin, jsonError } from "@/lib/http";
import { changeEmailSchema } from "@/lib/validators";
import { User } from "@/models/User";

export const runtime = "nodejs";

const TAKEN = "Another account already uses this email";

export async function POST(request: NextRequest) {
  if (!isTrustedOrigin(request)) return jsonError("Invalid request origin", 403);
  try {
    const user = await requireApiUser();
    const parsed = changeEmailSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("Enter a valid email and your password");
    if (parsed.data.email === user.email) return jsonError("That's already your email");
    await dbConnect();
    const doc = await User.findById(user.id).select("+passwordHash email");
    if (!doc || !(await compare(parsed.data.password, doc.passwordHash))) return jsonError("That password isn't right", 403);
    if (await User.exists({ email: parsed.data.email })) return jsonError(TAKEN, 409);
    doc.email = parsed.data.email;
    try {
      await doc.save();
    } catch (error) {
      if (typeof error === "object" && error && "code" in error && error.code === 11000) return jsonError(TAKEN, 409);
      throw error;
    }
    return NextResponse.json({ email: String(doc.email) });
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHORIZED") return jsonError("Unauthorized", 401);
    throw e;
  }
}
