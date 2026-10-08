import { Types } from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { dbConnect } from "@/lib/db";
import { isTrustedOrigin, jsonError } from "@/lib/http";
import { smsAccountSchema } from "@/lib/validators";
import { PayeeRule } from "@/models/PayeeRule";
import { User } from "@/models/User";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "private, no-store" };

// Bank accounts seen in SMS (each can be switched off) and the payees Flow has learned.
export async function GET() {
  try {
    const user = await requireApiUser();
    await dbConnect();
    const [doc, rules] = await Promise.all([
      User.findById(user.id).select("smsAccounts").lean(),
      PayeeRule.find({ userId: user.id }).sort({ updatedAt: -1 }).limit(300).lean(),
    ]);
    return NextResponse.json({
      accounts: (doc?.smsAccounts ?? []).map((a: { label: string; enabled?: boolean; lastSeenAt?: Date }) => ({ label: a.label, enabled: a.enabled !== false, lastSeenAt: a.lastSeenAt ?? null })),
      rules: rules.map((r) => ({ id: String(r._id), payee: String(r.payee || r.payeeKey), band: String(r.band), kind: String(r.kind), category: String(r.category ?? ""), uses: Number(r.uses ?? 0) })),
    }, { headers: NO_STORE });
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHORIZED") return jsonError("Unauthorized", 401);
    throw e;
  }
}

export async function PATCH(request: NextRequest) {
  if (!isTrustedOrigin(request)) return jsonError("Invalid request origin", 403);
  try {
    const user = await requireApiUser();
    const parsed = smsAccountSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("Invalid account");
    await dbConnect();
    const result = await User.updateOne({ _id: user.id, "smsAccounts.label": parsed.data.label }, { $set: { "smsAccounts.$.enabled": parsed.data.enabled } });
    if (!result.matchedCount) return jsonError("Account not found", 404);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHORIZED") return jsonError("Unauthorized", 401);
    throw e;
  }
}

// ?rule=<id> forgets one learned payee.
export async function DELETE(request: NextRequest) {
  if (!isTrustedOrigin(request)) return jsonError("Invalid request origin", 403);
  try {
    const user = await requireApiUser();
    const id = request.nextUrl.searchParams.get("rule") ?? "";
    if (!Types.ObjectId.isValid(id)) return jsonError("Not found", 404);
    await dbConnect();
    await PayeeRule.deleteOne({ _id: id, userId: user.id });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHORIZED") return jsonError("Unauthorized", 401);
    throw e;
  }
}
