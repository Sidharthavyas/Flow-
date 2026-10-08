import { Types } from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { dbConnect } from "@/lib/db";
import { isTrustedOrigin, jsonError } from "@/lib/http";
import { rupeesToPaise } from "@/lib/money";
import { serializeExpense } from "@/lib/serializers";
import { rememberPayee } from "@/lib/sms/ingest";
import { expenseSchema } from "@/lib/validators";
import { Expense } from "@/models/Expense";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  if (!isTrustedOrigin(request)) return jsonError("Invalid request origin", 403);
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    if (!Types.ObjectId.isValid(id)) return jsonError("Not found", 404);
    const parsed = expenseSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("Please check the expense details");
    await dbConnect();
    const doc = await Expense.findOneAndUpdate(
      { _id: id, userId: user.id },
      {
        amountPaise: rupeesToPaise(parsed.data.amount), category: parsed.data.category, dateKey: parsed.data.date,
        name: parsed.data.name, payment: parsed.data.payment, type: parsed.data.type,
        recurring: parsed.data.recurring, extra: parsed.data.extra, needsReview: false,
      },
      { new: true, runValidators: true }
    ).lean();
    if (!doc) return jsonError("Not found", 404);
    // Correcting an SMS-added expense teaches Flow that payee for next time.
    if (doc.source === "sms" && doc.payee) await rememberPayee({ userId: user.id, payee: String(doc.payee), amount: parsed.data.amount, kind: "expense", category: parsed.data.category });
    return NextResponse.json({ expense: serializeExpense(doc as never) });
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
    const result = await Expense.deleteOne({ _id: id, userId: user.id });
    if (!result.deletedCount) return jsonError("Not found", 404);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHORIZED") return jsonError("Unauthorized", 401);
    throw e;
  }
}
