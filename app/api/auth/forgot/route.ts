import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { emailResetEnabled } from "@/lib/admin";
import { hashToken } from "@/lib/auth";
import { dbConnect } from "@/lib/db";
import { isTrustedOrigin, jsonError } from "@/lib/http";
import { appUrl, escapeHtml, mailEnabled, sendMail } from "@/lib/mail";
import { forgotPasswordSchema } from "@/lib/validators";
import { PasswordReset } from "@/models/PasswordReset";
import { User } from "@/models/User";

export const runtime = "nodejs";

const LINK_MINUTES = 30;
const MAX_LINKS_PER_WINDOW = 3;

// Always answers the same way whether or not the email has an account, so it can't be used to discover users.
export async function POST(request: NextRequest) {
  if (!isTrustedOrigin(request)) return jsonError("Invalid request origin", 403);
  const parsed = forgotPasswordSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Enter a valid email address");
  if (!emailResetEnabled()) return jsonError("Email reset is turned off. Use your recovery code, or ask the Flow admin for a reset link.", 503);
  if (!mailEnabled() && process.env.NODE_ENV === "production") {
    return jsonError("Password reset email isn't set up yet. Ask the Flow admin to reset it for you.", 503);
  }

  await dbConnect();
  const user = await User.findOne({ email: parsed.data.email }).select("name email").lean();
  if (user) {
    const recent = await PasswordReset.countDocuments({ userId: user._id, createdAt: { $gt: new Date(Date.now() - LINK_MINUTES * 60_000) } });
    if (recent < MAX_LINKS_PER_WINDOW) {
      const token = randomBytes(32).toString("base64url");
      await PasswordReset.create({ userId: user._id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + LINK_MINUTES * 60_000) });
      const link = `${appUrl(request.nextUrl.origin)}/reset-password?token=${encodeURIComponent(token)}`;
      const firstName = String(user.name).trim().split(/\s+/)[0] || "there";
      const sent = await sendMail({
        to: String(user.email),
        subject: "Reset your Flow password",
        text: `Hi ${firstName},\n\nUse this link to choose a new Flow password. It works once and expires in ${LINK_MINUTES} minutes:\n\n${link}\n\nIf you didn't ask for this, ignore this email. Your password stays the same.`,
        html: `<p>Hi ${escapeHtml(firstName)},</p><p>Use the button below to choose a new Flow password. It works once and expires in ${LINK_MINUTES} minutes.</p><p><a href="${link}" style="display:inline-block;padding:12px 18px;border-radius:12px;background:#f4b073;color:#3e2513;font-weight:700;text-decoration:none">Reset password</a></p><p style="color:#777;font-size:13px">If you didn't ask for this, ignore this email. Your password stays the same.</p>`,
      });
      // Server logs only (never shown to the visitor), so delivery problems can be diagnosed without exposing who has an account.
      console.info(`Password reset for user ${String(user._id)}: ${sent ? "email accepted by provider" : "email NOT sent"}`);
    } else console.info(`Password reset for user ${String(user._id)}: skipped, ${recent} links already sent in the last ${LINK_MINUTES} min`);
  } else console.info("Password reset requested for an email with no account");
  return NextResponse.json({ ok: true });
}
