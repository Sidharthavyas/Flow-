import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { dbConnect } from "@/lib/db";
import { jsonError } from "@/lib/http";
import { paiseToRupees } from "@/lib/money";
import { looksLikePerson, suggestionsFor } from "@/lib/sms/classify";
import { serializeExpense } from "@/lib/serializers";
import { Expense } from "@/models/Expense";

export const runtime = "nodejs";

// Payments added from SMS that still need a category ("To review"). They already count toward the budget.
export async function GET() {
  try {
    const user = await requireApiUser();
    await dbConnect();
    const docs = await Expense.find({ userId: user.id, source: "sms", needsReview: true }).sort({ dateKey: -1, createdAt: -1 }).limit(100).lean();
    const items = docs.map((doc) => {
      const amount = paiseToRupees(Number(doc.amountPaise)), payee = String(doc.payee || doc.name || "");
      const guess = doc.category && doc.category !== "Other" ? String(doc.category) : undefined;
      return { ...serializeExpense(doc as never), suggestions: suggestionsFor({ amount, person: looksLikePerson(payee), guess, method: doc.payment === "Cash" ? "ATM" : "" }) };
    });
    return NextResponse.json({ items }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHORIZED") return jsonError("Unauthorized", 401);
    throw e;
  }
}
