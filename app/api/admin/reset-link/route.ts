import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { isAdminEmail } from "@/lib/admin";
import { hashToken, requireApiUser } from "@/lib/auth";
import { dbConnect } from "@/lib/db";
import { isTrustedOrigin, jsonError } from "@/lib/http";
import { appUrl } from "@/lib/mail";
import { adminResetLinkSchema } from "@/lib/validators";
import { PasswordReset } from "@/models/PasswordReset";
import { User } from "@/models/User";

export const runtime = "nodejs";

const LINK_HOURS = 24;

// Admin-only: makes a one-time reset link for someone who lost both their password and recovery code,
// for the admin to send them personally (e.g. on WhatsApp). Uses the same /reset-password page as email links.
export async function POST(request: NextRequest) {
  if (!isTrustedOrigin(request)) return jsonError("Invalid request origin", 403);
  try {
    const admin = await requireApiUser();
    if (!isAdminEmail(admin.email)) return jsonError("Only the Flow admin can do this", 403);
    const parsed = adminResetLinkSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("Enter a valid email address");
    await dbConnect();
    const user = await User.findOne({ email: parsed.data.email }).select("name").lean();
    if (!user) return jsonError("No Flow account uses that email", 404);
    // A new link replaces any older ones, so only the latest link you sent works.
    await PasswordReset.deleteMany({ userId: user._id });
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + LINK_HOURS * 3_600_000);
    await PasswordReset.create({ userId: user._id, tokenHash: hashToken(token), expiresAt });
    console.info(`Admin ${admin.id} created a reset link for user ${String(user._id)}`);
    return NextResponse.json({
      name: String(user.name), expiresAt: expiresAt.toISOString(),
      link: `${appUrl(request.nextUrl.origin)}/reset-password?token=${encodeURIComponent(token)}`,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHORIZED") return jsonError("Unauthorized", 401);
    throw e;
  }
}
