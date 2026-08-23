import { compare } from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { createSession } from "@/lib/auth";
import { dbConnect } from "@/lib/db";
import { isTrustedOrigin, jsonError } from "@/lib/http";
import { loginSchema } from "@/lib/validators";
import { User } from "@/models/User";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!isTrustedOrigin(request)) return jsonError("Invalid request origin", 403);
  const parsed = loginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid email or password", 401);
  await dbConnect();
  const user = await User.findOne({ email: parsed.data.email }).select("+passwordHash name email");
  const valid = user ? await compare(parsed.data.password, user.passwordHash) : false;
  if (!user || !valid) return jsonError("Invalid email or password", 401);
  await createSession(String(user._id));
  return NextResponse.json({ ok: true });
}
