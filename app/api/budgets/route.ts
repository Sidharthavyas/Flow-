import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { dbConnect } from "@/lib/db";
import { isTrustedOrigin, jsonError } from "@/lib/http";
import { paiseToRupees, rupeesToPaise } from "@/lib/money";
import { budgetSchema } from "@/lib/validators";
import { Budget } from "@/models/Budget";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser();
    const periodType = request.nextUrl.searchParams.get("periodType");
    const periodStart = request.nextUrl.searchParams.get("periodStart");
    if (!periodType || !periodStart || !["week", "month"].includes(periodType)) return jsonError("Invalid period");
    await dbConnect();
    const doc = await Budget.findOne({ userId: user.id, periodType, periodStart }).lean();
    return NextResponse.json({ budget: doc ? { amount: paiseToRupees(Number(doc.amountPaise)) } : null });
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHORIZED") return jsonError("Unauthorized", 401);
    throw e;
  }
}

export async function PUT(request: NextRequest) {
  if (!isTrustedOrigin(request)) return jsonError("Invalid request origin", 403);
  try {
    const user = await requireApiUser();
    const parsed = budgetSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("Please check the budget");
    await dbConnect();
    await Budget.findOneAndUpdate(
      { userId: user.id, periodType: parsed.data.periodType, periodStart: parsed.data.periodStart },
      { amountPaise: rupeesToPaise(parsed.data.amount) },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );
    return NextResponse.json({ budget: { amount: parsed.data.amount } });
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHORIZED") return jsonError("Unauthorized", 401);
    throw e;
  }
}
