import { Types } from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { dbConnect } from "@/lib/db";
import { isTrustedOrigin, jsonError } from "@/lib/http";
import { rupeesToPaise } from "@/lib/money";
import { serializeSaving } from "@/lib/serializers";
import { savingSchema } from "@/lib/validators";
import { Saving } from "@/models/Saving";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  if (!isTrustedOrigin(request)) return jsonError("Invalid request origin", 403);
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    if (!Types.ObjectId.isValid(id)) return jsonError("Not found", 404);
    const parsed = savingSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError(parsed.error.issues[0]?.message || "Please check the savings details");
    await dbConnect();
    const doc = await Saving.findOneAndUpdate(
      { _id: id, userId: user.id },
      {
        action: parsed.data.action,
        amountPaise: rupeesToPaise(parsed.data.amount),
        dateKey: parsed.data.date,
        fromAccount: parsed.data.fromAccount,
        toAccount: parsed.data.toAccount,
        method: parsed.data.method,
        note: parsed.data.note,
      },
      { new: true, runValidators: true }
    ).lean();
    if (!doc) return jsonError("Not found", 404);
    return NextResponse.json({ saving: serializeSaving(doc as never) });
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHORIZED") return jsonError("Unauthorized", 401);
    throw e;
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  if (!isTrustedOrigin(request)) return jsonError("Invalid request origin", 403);
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    if (!Types.ObjectId.isValid(id)) return jsonError("Not found", 404);
    await dbConnect();
    const result = await Saving.deleteOne({ _id: id, userId: user.id });
    if (!result.deletedCount) return jsonError("Not found", 404);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHORIZED") return jsonError("Unauthorized", 401);
    throw e;
  }
}
