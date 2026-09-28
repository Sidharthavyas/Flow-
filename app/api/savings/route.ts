import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { dbConnect } from "@/lib/db";
import { isTrustedOrigin, jsonError } from "@/lib/http";
import { rupeesToPaise } from "@/lib/money";
import { serializeSaving } from "@/lib/serializers";
import { savingSchema } from "@/lib/validators";
import { Saving } from "@/models/Saving";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireApiUser();
    await dbConnect();
    const docs = await Saving.find({ userId: user.id }).sort({ dateKey: -1, createdAt: -1 }).limit(5000).lean();
    return NextResponse.json({ savings: docs.map((d) => serializeSaving(d as never)) });
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHORIZED") return jsonError("Unauthorized", 401);
    throw e;
  }
}

export async function POST(request: NextRequest) {
  if (!isTrustedOrigin(request)) return jsonError("Invalid request origin", 403);
  try {
    const user = await requireApiUser();
    const parsed = savingSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError(parsed.error.issues[0]?.message || "Please check the savings details");
    await dbConnect();
    const doc = await Saving.create({
      userId: user.id,
      action: parsed.data.action,
      amountPaise: rupeesToPaise(parsed.data.amount),
      dateKey: parsed.data.date,
      fromAccount: parsed.data.fromAccount,
      toAccount: parsed.data.toAccount,
      method: parsed.data.method,
      note: parsed.data.note,
    });
    return NextResponse.json({ saving: serializeSaving(doc.toObject()) }, { status: 201 });
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHORIZED") return jsonError("Unauthorized", 401);
    throw e;
  }
}
