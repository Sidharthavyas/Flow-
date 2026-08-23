import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { dbConnect } from "@/lib/db";
import { isTrustedOrigin, jsonError } from "@/lib/http";
import { rupeesToPaise } from "@/lib/money";
import { serializeExpense } from "@/lib/serializers";
import { expenseSchema } from "@/lib/validators";
import { Expense } from "@/models/Expense";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser();
    const from = request.nextUrl.searchParams.get("from");
    const to = request.nextUrl.searchParams.get("to");
    const query: Record<string, unknown> = { userId: user.id };
    if (from || to) query.dateKey = { ...(from ? { $gte: from } : {}), ...(to ? { $lt: to } : {}) };
    await dbConnect();
    const docs = await Expense.find(query).sort({ dateKey: -1, createdAt: -1 }).limit(2500).lean();
    return NextResponse.json({ expenses: docs.map((d) => serializeExpense(d as never)) });
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHORIZED") return jsonError("Unauthorized", 401);
    throw e;
  }
}

export async function POST(request: NextRequest) {
  if (!isTrustedOrigin(request)) return jsonError("Invalid request origin", 403);
  try {
    const user = await requireApiUser();
    const parsed = expenseSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("Please check the expense details");
    await dbConnect();
    const doc = await Expense.create({
      userId: user.id,
      amountPaise: rupeesToPaise(parsed.data.amount),
      category: parsed.data.category,
      dateKey: parsed.data.date,
      name: parsed.data.name,
      payment: parsed.data.payment,
      type: parsed.data.type,
      recurring: parsed.data.recurring,
      extra: parsed.data.extra,
    });
    return NextResponse.json({ expense: serializeExpense(doc.toObject()) }, { status: 201 });
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHORIZED") return jsonError("Unauthorized", 401);
    throw e;
  }
}
