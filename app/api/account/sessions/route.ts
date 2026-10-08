import { NextRequest, NextResponse } from "next/server";
import { destroyOtherSessions, requireApiUser } from "@/lib/auth";
import { isTrustedOrigin, jsonError } from "@/lib/http";

export const runtime = "nodejs";

// "Sign out of other devices": ends every session except the one making this request.
export async function DELETE(request: NextRequest) {
  if (!isTrustedOrigin(request)) return jsonError("Invalid request origin", 403);
  try {
    const user = await requireApiUser();
    const signedOut = await destroyOtherSessions(user.id);
    return NextResponse.json({ ok: true, signedOut });
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHORIZED") return jsonError("Unauthorized", 401);
    throw e;
  }
}
