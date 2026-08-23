import { hash } from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { createSession } from "@/lib/auth";
import { dbConnect } from "@/lib/db";
import { isTrustedOrigin, jsonError } from "@/lib/http";
import { registerSchema } from "@/lib/validators";
import { User } from "@/models/User";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!isTrustedOrigin(request)) return jsonError("Invalid request origin", 403);
  const parsed = registerSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Please check your details");
  await dbConnect();
  const exists = await User.exists({ email: parsed.data.email });
  if (exists) return jsonError("An account already exists for this email", 409);
  const passwordHash = await hash(parsed.data.password, 12);
  try {
    const user = await User.create({ name: parsed.data.name, email: parsed.data.email, passwordHash });
    await createSession(String(user._id));
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === 11000) return jsonError("An account already exists for this email", 409);
    throw error;
  }
}
