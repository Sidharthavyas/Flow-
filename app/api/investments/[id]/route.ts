import { Types } from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { dbConnect } from "@/lib/db";
import { isTrustedOrigin, jsonError } from "@/lib/http";
import { rupeesToPaise } from "@/lib/money";
import { serializeInvestment } from "@/lib/serializers";
import { investmentSchema } from "@/lib/validators";
import { Investment } from "@/models/Investment";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  if (!isTrustedOrigin(request)) return jsonError("Invalid request origin", 403);
  try {
    const user = await requireApiUser(); const { id } = await context.params;
    if (!Types.ObjectId.isValid(id)) return jsonError("Not found", 404);
    const parsed = investmentSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("Please check the investment details");
    await dbConnect();
    const doc = await Investment.findOneAndUpdate(
      { _id: id, userId: user.id },
      {
        name: parsed.data.name, type: parsed.data.type, investedPaise: rupeesToPaise(parsed.data.invested),
        currentPaise: rupeesToPaise(parsed.data.current), dateKey: parsed.data.date, frequency: parsed.data.frequency,
        rate: parsed.data.rate, platform: parsed.data.platform, maturityKey: parsed.data.maturity, note: parsed.data.note,
      },
      { new: true, runValidators: true }
    ).lean();
    if (!doc) return jsonError("Not found", 404);
    return NextResponse.json({ investment: serializeInvestment(doc as never) });
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHORIZED") return jsonError("Unauthorized", 401);
    throw e;
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  if (!isTrustedOrigin(request)) return jsonError("Invalid request origin", 403);
  try {
    const user = await requireApiUser(); const { id } = await context.params;
    if (!Types.ObjectId.isValid(id)) return jsonError("Not found", 404);
    await dbConnect();
    const result = await Investment.deleteOne({ _id: id, userId: user.id });
    if (!result.deletedCount) return jsonError("Not found", 404);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHORIZED") return jsonError("Unauthorized", 401);
    throw e;
  }
}
