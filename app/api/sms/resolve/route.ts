import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { dbConnect } from "@/lib/db";
import { isTrustedOrigin, jsonError } from "@/lib/http";
import { resolveSmsExpense } from "@/lib/sms/ingest";
import { shortLabel } from "@/lib/sms/classify";
import { smsResolveSchema } from "@/lib/validators";

export const runtime = "nodejs";

// The answer to "What was it?", from a notification button or the To review list. Flow remembers it for this payee.
export async function POST(request: NextRequest) {
  if (!isTrustedOrigin(request)) return jsonError("Invalid request origin", 403);
  try {
    const user = await requireApiUser();
    const parsed = smsResolveSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("Invalid answer");
    await dbConnect();
    const result = await resolveSmsExpense({ userId: user.id, ...parsed.data });
    if (!result) return jsonError("That payment was already sorted or deleted", 404);
    const others = result.applied > 1 ? ` (and ${result.applied - 1} more from ${result.payee})` : "";
    const message = result.kind === "transfer" ? `Not counted as spending${others}` : `Saved as ${shortLabel(result.category)}${others}`;
    return NextResponse.json({ ok: true, applied: result.applied, message });
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHORIZED") return jsonError("Unauthorized", 401);
    if (e instanceof Error && e.message === "BAD_CATEGORY") return jsonError("Choose a category");
    throw e;
  }
}
